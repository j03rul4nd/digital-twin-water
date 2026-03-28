# Water Treatment Digital Twin — Starter Kit

<!-- GIF del dashboard funcionando va aquí — capturar con Filter #1 en rojo -->
<!-- ![WTP Digital Twin demo](docs/demo.gif) -->
![WTP Digital Twin](docs/cover.png)

**[→ Live Demo](https://j03rul4nd.github.io/digital-twin-water/)** · Three.js · MQTT · No backend · No database · Runs entirely in the browser

---

![WTP Digital Twin](docs/cover_2.png)

## What is this

A starter kit that lets any developer spin up a **working digital twin of a water treatment plant in under 30 minutes** — with live sensor simulation, real-time 3D visualization, a rule engine that detects process anomalies, trend detection that predicts failures before they happen, and webhook alerts that notify your team when something goes wrong.

No Docker, no server, no auth. Fork it, swap in your sensors, connect your real MQTT broker.

---

## Quick Start

```bash
git clone https://github.com/j03rul4nd/digital-twin-water.git
cd digital-twin-water
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the simulator starts immediately.

---

## Features

**Real-time 3D visualization**
Procedural plant model in Three.js. Each mesh is bound to a sensor — when an alert fires, the corresponding 3D object glows. ISA-101 color coding: gray is normal, amber is warning, red is danger.

**Rule engine with trend detection**
15 rules evaluated every 500ms. Threshold rules catch active anomalies. Trend rules use linear regression to predict failures before they cross the threshold.

**Webhook alerts**
Get notified outside the browser when alerts fire. Configure any number of webhook URLs from the UI — no code changes. Works with Slack, Discord, n8n, Make, Zapier, or any URL accepting POST JSON.

**Flexible payload mapping**
Connect any MQTT broker regardless of payload format. Auto-detect handles Sparkplug-like arrays, flat fields, and nested objects. Custom mapping lets you define `data.process.flow` → `inlet_flow` with a UI.

**Sensor history charts**
Click any sensor row for a live chart of the last 3 minutes with warning/danger reference lines, min/avg/max stats, and 500ms update rate.

**Alert history**
Resolved alerts move to a History section with duration ("active 45s") and resolution timestamp — not just a live list.

**Incident simulator**
Trigger fault scenarios from the UI. Five built-in scenarios run for 30 seconds and reset automatically. Useful for demos and for testing alert rules.

**UI-configurable broker**
Set broker URL, credentials, and plant ID from the dashboard. Config saved in `localStorage`. No code changes needed.

---

## Connect your real MQTT broker

**1.** Click **`Configure & Connect →`** in the MQTT panel.

**2.** Fill in Broker URL, Username, Password, Plant ID → **`Test & Connect →`**

**3.** Publish your data to `wtp/plant/{plantId}/sensors`:

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

If your broker publishes a different format, click **`⇄ Payload`** in the topbar to configure the mapping. Paste a sample message and the auto-analyzer suggests the field mappings for you.

> Works with `ws://` and `wss://` brokers. For mutual TLS, you need a proxy — see [docs/mqtt-production.md](docs/mqtt-production.md).

---

## Webhook alerts

Click **`⚡ Webhooks`** in the topbar to configure alert notifications.

Each webhook has a URL, a name, and the events it listens to:

| Event | Fires when |
|---|---|
| `alert.danger` | A danger-level alert activates |
| `alert.warning` | A warning-level alert activates |
| `alert.resolved` | Any alert clears |

Payload sent (verified working with webhook.site, Slack, Discord, n8n):

```json
{
  "event": "alert.danger",
  "timestamp": 1774739174739,
  "plant": "plant-01",
  "alert": {
    "id": "chlorine_deficit",
    "severity": "danger",
    "sensorIds": ["inlet_flow", "chlorine_dose"],
    "message": "Chlorine dose not scaling with flow — disinfection deficit risk",
    "active": true
  }
}
```

Use the **Test →** button in the webhook form to verify your URL before saving.

---

## Adding your own alert rules

```js
// src/sensors/RuleEngine.js — add to the RULES array

// Simple threshold rule
{
  id:        'high_pressure',
  severity:  'warning',
  sensorIds: ['outlet_pressure'],
  message:   'Distribution pressure too high',
  condition: (readings) => readings.outlet_pressure > 6.5,
},

// Trend rule — detects a rising pattern over a time window
{
  id:        'pressure_rising',
  severity:  'warning',
  sensorIds: ['outlet_pressure'],
  message:   'Distribution pressure rising fast',
  condition: (readings, state) => {
    const trend = state.getTrend('outlet_pressure', 60); // last 60 seconds
    if (!trend || trend.samples < 10) return false;
    return trend.direction === 'rising' && trend.slope > 0.05;
  },
},
```

`getTrend()` returns `{ slope, delta, deltaRel, direction, samples, mean, first, last }` via linear regression. The rule engine handles the full alert lifecycle — activate, persist, resolve, move to history.

---

## Adding your own sensors

```js
// src/sensors/SensorConfig.js
{
  id: 'my_sensor', label: 'My Sensor', unit: 'bar',
  rangeMin: 0, rangeMax: 10,
  normal:  { low: 2, high: 8 },
  warning: { low: 1, high: 9 },
  danger:  { low: 0, high: 10 },
}

// src/sensors/SensorSceneMap.js
my_sensor: ['mesh_pump_station'],
```

---

## Architecture

```
sensor.worker.js  (Web Worker — isolated from render loop)
  │  500ms snapshots + incident scenarios
  ▼
main.js → SensorState.update()     ← single source of truth + history buffer
        → EventBus.emit(SENSOR_UPDATE)
  │
  ├──▶ RuleEngine      threshold + trend rules → RULE_TRIGGERED
  │      └──▶ AlertPanel       active list + history
  │      └──▶ AlertSystem      emissive glow on 3D meshes
  │      └──▶ WebhookManager   POST to configured URLs (text/plain, no CORS preflight)
  │
  ├──▶ SceneUpdater    ColorMapper → mesh.material.color
  └──▶ TelemetryPanel  rows → click → SensorDetailModal (live SVG chart)

MQTTAdapter  (real broker)
  │  PayloadMapper.transform() — auto/flat/custom format handling
  └──▶ same SensorState → same pipeline → zero downstream changes

IncidentPanel  → SensorWorker.scenario(name, 30s) → worker overrides values
```

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

**V1.1 — Complete ✅** Historical charts · Incident simulator · Trend detection

**V1.2 — Complete ✅** Webhook alerts · Flexible payload mapping

**V1.3 — Planned**
- Sparkplug B payload support (Ignition, Cirrus Link, modern PLCs)
- Process KPIs (throughput, time-in-warning, chlorination efficiency)
- MCP server for Claude Desktop integration

**V2.0 — Planned**
- [`feature/ai-advisor`](../../tree/feature/ai-advisor): TinyLlama via WebLLM, natural language process diagnostics

---

## Stack

| Layer | Tech | Why |
|---|---|---|
| Bundler | Vite | HMR without reloading WebGL |
| 3D | Three.js | WebGL2, procedural model |
| Realtime | Web Worker + MQTT.js | Worker isolates render loop |
| Map | Leaflet + OSM | Free, no API key |
| Deploy | GitHub Pages / Vercel | Static build, free |

---

## Built by

[Joel Benitez](https://joelbenitez.dev) · [LinkedIn](https://www.linkedin.com/in/joel-benitez-iiot-industry/) · [Medium](https://medium.com/@jowwii)

---

*Star the repo if this saved you from another heavyweight platform. Issues and PRs welcome.*