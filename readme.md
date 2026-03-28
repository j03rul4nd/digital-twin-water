# Water Treatment Digital Twin — Starter Kit

<!-- GIF del dashboard funcionando va aquí — capturar con Filter #1 en rojo (estado más visual) -->
<!-- ![WTP Digital Twin demo](docs/demo.gif) -->
![WTP Digital Twin](docs/cover.png)

**[→ Live Demo](https://j03rul4nd.github.io/digital-twin-water/)** · Three.js · MQTT · No backend · No database · Runs entirely in the browser

---

![WTP Digital Twin](docs/cover_2.png)

## What is this

A starter kit that lets any developer spin up a **working digital twin of a water treatment plant in under 30 minutes** — with live sensor simulation, real-time 3D visualization, a rule engine that detects process anomalies, and a trend detection system that predicts failures before they happen.

No Docker, no server, no auth. Fork it, swap in your sensors, connect your real MQTT broker.

Designed to live exactly between repos that are too simple (just Three.js with no data) and too complex (FUXA, ThingsBoard, iTwin.js).

---

## Quick Start

```bash
git clone https://github.com/j03rul4nd/digital-twin-water.git
cd digital-twin-water
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the simulator starts immediately. No configuration needed.

---

## Features

**Real-time 3D visualization**
Procedural plant model built with Three.js. Each mesh is bound to a sensor — when an alert fires, the corresponding 3D object glows in the scene. Color follows ISA-101: gray is normal, amber is warning, red is danger.

**Rule engine with trend detection**
Evaluates 15 rules every 500ms. Threshold rules catch active anomalies. Trend rules use linear regression over a time window to predict failures before they cross the threshold — filter clogging, tank draining, sudden flow drops, turbidity drift.

**Sensor history charts**
Click any sensor row to open a live chart of the last 3 minutes. Min, avg, max and sample count update in real time. Warning and danger reference lines overlaid on the chart.

**Alert history**
Resolved alerts don't disappear — they move to a History section with duration ("active 45s") and resolution timestamp. The operator always knows what happened and when.

**Incident simulator**
Trigger fault scenarios from the UI without writing code. Five built-in scenarios (filter clog, critical pressure, chlorine deficit, low tank, pH anomaly) each run for 30 seconds and reset automatically. Useful for demos and for testing your own alert rules.

**UI-configurable MQTT**
Click "Configure & Connect →" to enter broker URL, credentials and plant ID. No code changes needed. Config is saved in `localStorage` and restored on reload.

---

## Connect your real MQTT broker

The simulator runs out of the box. When you're ready to connect real data:

**1. Click `Configure & Connect →`** in the MQTT panel on the right side of the dashboard.

**2. Fill in your broker details:**
- **Broker URL** — e.g. `wss://your-cluster.hivemq.cloud:8884/mqtt`
- **Username** and **Password**
- **Plant ID** — used to build the subscription topic

**3. Click `Test & Connect →`** — the dashboard tests the connection live. On success the config saves automatically and the simulator pauses.

**4. Publish your sensor data** to `wtp/plant/{plantId}/sensors`:

```json
{
  "timestamp": 1234567890123,
  "readings": {
    "inlet_flow": 142.3,
    "raw_turbidity": 4.2,
    "coag_ph": 7.1,
    "filter_1_dp": 98.0,
    "filter_2_dp": 102.5,
    "filtered_turbidity": 0.28,
    "chlorine_dose": 1.8,
    "residual_chlorine": 0.45,
    "tank_level": 67.0,
    "outlet_pressure": 4.2
  }
}
```

> Works with `ws://` and `wss://` brokers. For mutual TLS installations, you need an intermediate proxy — see [docs/mqtt-production.md](docs/mqtt-production.md).

Full Python publishing example: [docs/mqtt-production.md](docs/mqtt-production.md)

---

## Adding your own alert rules

Open `src/sensors/RuleEngine.js` and add an object to the `RULES` array:

```js
// Simple threshold rule
{
  id:        'my_pressure_rule',
  severity:  'warning',
  sensorIds: ['outlet_pressure'],
  message:   'Distribution pressure too high — check downstream valves',
  condition: (readings) => readings.outlet_pressure > 6.5,
}
```

For trend-based rules, use the `state` argument to access the history buffer:

```js
// Trend rule — detects a rising pattern over time
{
  id:        'pressure_rising',
  severity:  'warning',
  sensorIds: ['outlet_pressure'],
  message:   'Distribution pressure rising fast — check pump settings',
  condition: (readings, state) => {
    const trend = state.getTrend('outlet_pressure', 60); // last 60 seconds
    if (!trend || trend.samples < 10) return false;
    return trend.direction === 'rising' && trend.slope > 0.05; // > 0.05 bar/s
  },
}
```

`getTrend()` returns `{ slope, delta, deltaRel, direction, samples, mean, first, last }` computed via linear regression. `direction` is `'rising'`, `'falling'`, or `'stable'`.

The rule engine evaluates every 500ms. When the condition is true, the alert appears in the panel and the corresponding 3D mesh starts glowing. When the condition clears, the alert moves to History automatically.

---

## Adding your own sensors

Add an entry to `src/sensors/SensorConfig.js`:

```js
{
  id:       'my_sensor',
  label:    'My Sensor',
  unit:     'bar',
  rangeMin: 0,
  rangeMax: 10,
  normal:   { low: 2, high: 8 },
  warning:  { low: 1, high: 9 },
  danger:   { low: 0, high: 10 },
}
```

Then bind it to a 3D mesh in `src/sensors/SensorSceneMap.js`:

```js
my_sensor: ['mesh_pump_station'],
```

---

## Architecture

```
sensor.worker.js  (Web Worker — isolated from render loop)
  │  generates complete snapshot every 500ms
  │  supports incident scenarios: { cmd: 'scenario', name, durationMs }
  │  { timestamp, readings: { all sensors } }
  │  postMessage → main thread
  ▼
main.js → SensorState.update()        ← single source of truth + history buffer
        → EventBus.emit(SENSOR_UPDATE)
  │
  ├──▶ RuleEngine      evaluates RULES[] every tick
  │      ├── threshold rules  — condition(readings)
  │      └── trend rules      — condition(readings, SensorState) → getTrend()
  │           └──▶ EventBus.emit(RULE_TRIGGERED, { active: true/false })
  │                   ├──▶ AlertPanel       active list + history section
  │                   └──▶ AlertSystem      emissive glow on 3D meshes
  │
  ├──▶ SceneUpdater    ColorMapper → mesh.material.color per tick
  └──▶ TelemetryPanel  10 sensor rows → click → SensorDetailModal (live chart)

MQTTAdapter  (when user connects real broker)
  │  config stored in localStorage via ConfigModal — no code changes needed
  │  same payload shape as Worker — zero downstream changes
  └──▶ same SensorState → same EventBus → same RuleEngine

IncidentPanel  (simulator only)
  └──▶ SensorWorker.scenario(name, durationMs) → sensor.worker.js overrides values
```

Key design decisions:

- **No framework** — plain ES Modules. Maximum readability for forks.
- **Worker isolation** — the Three.js render loop never competes with simulation.
- **Observable adapter** — 4 MQTT lifecycle events. Swap any data source without touching downstream.
- **Deterministic rule engine** — zero latency. Threshold + trend rules in the same array.
- **Color as signal** — ISA-101. `--green`/`--amber`/`--red` exclusively for process state.
- **UI-configurable broker** — credentials never in code.

---

## Sensors

| ID | Measurement | Unit | Stage |
|---|---|---|---|
| `inlet_flow` | Inlet Flow Rate | m³/h | Intake |
| `raw_turbidity` | Raw Water Turbidity | NTU | Intake |
| `coag_ph` | Coagulation pH | pH | Coagulation |
| `filter_1_dp` | Filter #1 Differential Pressure | mbar | Filtration |
| `filter_2_dp` | Filter #2 Differential Pressure | mbar | Filtration |
| `filtered_turbidity` | Filtered Water Turbidity | NTU | Post-filtration |
| `chlorine_dose` | Chlorine Dose | mg/L | Chlorination |
| `residual_chlorine` | Residual Chlorine | mg/L | Distribution |
| `tank_level` | Clearwell Tank Level | % | Storage |
| `outlet_pressure` | Distribution Pressure | bar | Distribution |

---

## Roadmap

**V1.1 — Complete ✅**
- Historical charts per sensor (live SVG sparklines)
- Incident simulation mode (5 fault scenarios, 30s duration, auto-reset)
- Trend detection in rule engine (linear regression over configurable time windows)

**V2.0 — Planned**
- [`feature/ai-advisor`](../../tree/feature/ai-advisor) branch: TinyLlama via WebLLM for natural language process diagnostics (opt-in, ~700MB cached in IndexedDB)

---

## Stack

| Layer | Tech | Why |
|---|---|---|
| Bundler | Vite | HMR without reloading WebGL. Static build. |
| 3D | Three.js | WebGL2. Procedural model — no assets, no license issues. |
| Realtime | Web Worker + MQTT.js | Worker protects the render loop. |
| Map | Leaflet + OSM | Free forever. No API key. |
| Deploy | GitHub Pages / Vercel | Static build. Free. |

---

## Built by

[Joel Benitez](https://joelbenitez.dev) · [LinkedIn](https://www.linkedin.com/in/joel-benitez-iiot-industry/) · [Medium](https://medium.com/@jowwii)

---

*Star the repo if this saved you from another heavyweight platform. Issues and PRs welcome.*