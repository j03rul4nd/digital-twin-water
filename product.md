# Digital Twin Starter Kit — Product Document
### Water Treatment Plant Edition

> Living document. Update every time an architectural decision is made or the architecture changes.
>
> Last updated: Iteration 10 (V1.5 — FinancialAnalytics, FinancialConfig, renderFinancialConfigUI, financial KPIs in KPIEngine/KPIPanel, economic overlay layers in MultiChartPanel)

---

## What this project is

An open-source starter kit that lets any industrial developer spin up a **working digital twin of a drinking water treatment plant in under 30 minutes**. No backend, no database, no server. Runs 100% in the browser.

The goal is not to be a complete platform. It lives precisely between repos that are too simple (Three.js with no data) and repos that are too complex (Docker, server, authentication). That gap is what generates GitHub stars and real forks.

> **Chosen vertical: Water Treatment Plant.**
>
> Reasons: highest open-source activity in 2025, universally understandable sensors (pH, flow, chlorine, pressure), linear process flow that is visually intuitive, real demand from municipal and utility developers who are looking for exactly this on GitHub, and existing open-source competitors are all heavyweights with Docker and backends (FUXA, ThingsBoard, iTwin.js). Nobody has built the lightweight starter kit.

---

## Why Water Treatment Plant (and not Generic Factory)

|  | Generic Factory (rejected) | Water Treatment Plant (chosen) |
| --- | --- | --- |
| **Searches** | Most searched use case, also the most saturated | Specific searches with no lightweight open-source answer |
| **Competition** | Dozens of heavyweight repos already built | 0 lightweight starter kits exist |
| **Audience** | "Generic" has no fans — no loyal community | Municipal engineers and utilities are actively searching for this |
| **Sensors** | Generic, hard to identify without context | pH, flow, chlorine, pressure: understandable without context |
| **Visualization** | Complex process flow to represent | Linear flow: intake → filtration → chlorination → distribution |
| **Sharing** | Nobody shares a generic factory repo | A water engineer who sees it sends it to 10 colleagues |

---

## Technology stack

| Layer | Technology | Decision |
| --- | --- | --- |
| Bundler / Dev | **Vite** | HMR without reloading WebGL. Static build to `dist/`. Zero config. |
| Modules | **Native ES Modules** | No framework. Maximum portability, maximum readability for forks. |
| 3D Engine | **Three.js** | WebGL2. WebGPU not yet universally supported. |
| 3D Model | **Procedural (Three.js)** | Zero external dependencies. No ambiguous licenses. The model code is part of the learning experience. |
| RT Data | **Simulator in Web Worker** | Protects the Three.js render loop. Pluggable to a real MQTT broker with minimal config. |
| AI | **Deterministic RuleEngine (MVP)** | Zero download, zero latency. WebLLM moved to V2.0. |
| Geolocation | **Leaflet + OSM** | Free forever. Mapbox costs at scale. |
| Deploy | **GitHub Pages / Vercel** | Vite static build. Free, no VPS. |

### Why NOT WebLLM in the MVP

700MB download on a user's first visit who just wants to see a demo. Abandonment rate is ~90% before seeing anything work. Stars come from people who arrive at the repo, open the live demo, say "wow", and star it. If the "wow" takes 5 minutes to load, there are no stars.

Additional problem: `postMessage` between threads **copies** data instead of sharing it. With 10 sensors there's already serialization overhead every 500ms. Adding 700MB of model on top of that is unworkable for the demo.

WebLLM stays in the roadmap as **V2.0 opt-in** — separate branch, documented, but not in the MVP.

### Why NOT Next.js

Next.js adds SSR, SSG, routing, and API routes. This project needs none of them. Three.js needs `window` and `document`, which in Next.js forces `dynamic imports` with `ssr: false` almost everywhere. Unnecessary friction. Vite gives exactly the same result without the overhead.

### Why NOT Web Components

Shadow DOM and the custom elements registry add complexity without adding anything in this context. **Simple JS objects** that manipulate the DOM directly are used. More readable, easier to fork.

---

## Worker Architecture

The Three.js main thread is precious. If it blocks, rendering degrades. That's why heavy logic lives in separate Workers.

```
Main Thread                         sensor.worker.js
────────────────────                ─────────────────────────
Three.js render loop       ←───     SensorSimulator
DOM manipulation        postMessage  NoiseGenerator
EventBus dispatch          (single  Threshold pre-eval
SceneUpdater               object,
TelemetryPanel             all
ColorMapper                sensors,
AlertSystem                timestamp)
RuleEngine
SensorState (singleton)
```

**Critical Worker rule:** The Worker sends **a single object per tick** with all sensors and a timestamp. It never sends individual readings in isolation. The main thread has an `isProcessing` flag that discards messages while updating the scene — this prevents message queue buildup during slow renders or complex scenes.

---

## Closed Architecture Decisions

These decisions must be settled before writing the first module. If left for later, refactoring is guaranteed.

### Decision 1 — Worker payload format

The object `sensor.worker.js` sends to the main thread always has this shape:

```js
{
  timestamp: 1234567890,
  readings: {
    inlet_flow: 142.3,
    coag_ph: 7.1,
    raw_turbidity: 4.2,
    // ... all sensors in the same tick
  }
}
```

One object. All sensors. With timestamp. The `RuleEngine` **only evaluates complete snapshots** — never individual readings in isolation. This guarantees correct temporal correlations.

**Invalid value policy in the simulator:** if a sensor cannot generate a value in a tick (internal error, NaN produced by the noise generator), the Worker sends the **last known valid value** for that sensor — never `null`, never `undefined`, never omits the key. This guarantees `SensorState` and `RuleEngine` always receive an object with all 10 keys present. If it's the first tick and there's no prior value, the Worker uses the midpoint of the `normal` range defined in `SensorConfig`. This logic lives entirely in the Worker — the main thread never does defensive checks on missing keys.

### Decision 2 — State vs. notifications separation

The `EventBus` is for **notifications** ("a change happened"), not for state. The current sensor state lives in `SensorState.js`, a flat singleton that always reflects the last reading of each sensor.

```js
// SensorState.js — the single source of truth for current state
const SensorState = {
  readings: {},
  lastTimestamp: null,
  history: [],
  MAX_HISTORY: 360,

  update(snapshot) {
    this.readings = snapshot.readings;
    this.lastTimestamp = snapshot.timestamp;
    this.history.push(snapshot);
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
  },

  get(sensorId) {
    return this.readings[sensorId]; // undefined if no data yet
  },

  isReady() {
    return this.lastTimestamp !== null; // false until the first tick
  }
};
export default SensorState;
```

`TelemetryPanel`, `RuleEngine`, and any module that needs current state reads from `SensorState`, not from the event stream. The `EventBus` only emits `EVENTS.SENSOR_UPDATE` to notify that new data is available.

This avoids the zombie listener problem and the need to reconstitute state from missed events when someone forks and adds modules.

### Decision 3 — Sensor → 3D object binding

`SensorSceneMap.js` is the **single source of truth** for the binding between sensor IDs and Three.js mesh names. `SceneUpdater` never hardcodes Three.js object names — it always queries this map.

```js
// SensorSceneMap.js
export const SENSOR_SCENE_MAP = {
  inlet_flow:         ['mesh_inlet_pipe', 'mesh_inlet_channel'],
  raw_turbidity:      ['mesh_raw_water_tank'],
  coag_ph:            ['mesh_coag_tank_1', 'mesh_coag_tank_2'],
  filter_1_dp:        ['mesh_filter_1'],
  filter_2_dp:        ['mesh_filter_2'],
  filtered_turbidity: ['mesh_filtered_water_pipe'],
  chlorine_dose:      ['mesh_chlorination_room'],
  residual_chlorine:  ['mesh_distribution_pipe'],
  tank_level:         ['mesh_clearwell_tank'],
  outlet_pressure:    ['mesh_pump_station'],
};
```

Define mesh names **before** writing `ModelFactory.js`. The mesh name in Three.js (`mesh.name = 'mesh_inlet_pipe'`) must match the map exactly.

**Unknown ID policy:** if `SceneUpdater` receives a sensor ID that doesn't exist in `SensorSceneMap` (sensor added in fork, MQTT topic with different name), it emits a `console.warn` in dev mode and ignores it silently in production. It never throws an error that breaks the update loop. This policy is explicitly documented so forks know what to expect.

### Decision 4 — Honest MQTTAdapter limits

The `MQTTAdapter` works with brokers that support **MQTT over WebSocket** (`ws://` or `wss://` with simple credentials). For the demo, `broker.emqx.io:8083` can be used without extra config.

**What it does NOT support** (explicitly documented in README): mutual TLS with client certificates, which is the standard in real industrial PLCs. Browsers cannot do mutual TLS in WebSocket. For that case, the user needs a proxy or gateway — outside the scope of the starter kit.

**Observable MQTTAdapter lifecycle ★**

The Adapter exposes 4 states through the EventBus. `Toolbar.js` and any UI component that displays connection state must listen to these events — never assume connection state without subscribing:

```js
EVENTS.MQTT_CONNECTING     // user requested connection, process underway
EVENTS.MQTT_CONNECTED      // broker confirmed session
EVENTS.MQTT_ERROR          // auth, network, or broker-down failure
EVENTS.MQTT_DISCONNECTED   // session terminated (clean close or by error)
```

### Decision 5 — Subscription cleanup convention

Every module that subscribes to the EventBus **must** implement a `destroy()` method that calls `EventBus.off()`. This convention is documented and shown in the first module that uses EventBus — forks copy the pattern from the example code.

```js
// Mandatory pattern in all modules with subscriptions
const MyModule = {
  _handlers: [],
  init() {
    const handler = (data) => this._handle(data);
    EventBus.on(EVENTS.SENSOR_UPDATE, handler);
    this._handlers.push([EVENTS.SENSOR_UPDATE, handler]);
  },
  destroy() {
    this._handlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
    this._handlers = [];
  }
};
```

Without this, zombie listeners accumulate when restarting modules — especially visible when someone forks and adds hot-reload or simulation restart.

### Decision 6 — RuleEngine output contract ★

The RuleEngine evaluates complete snapshots and emits `EVENTS.RULE_TRIGGERED` with an `alert` object of fixed shape. **This contract cannot change without versioning the EventBus** — `AlertPanel.js` and `AlertSystem.js` depend on it directly.

```js
// alert shape — RuleEngine output contract
{
  id: 'filter_clogged_1',                          // unique, for deduplicating repeated alerts
  severity: 'warning' | 'danger',                  // determines color and priority in UI
  sensorIds: ['filter_1_dp', 'filtered_turbidity'], // which sensors triggered the rule
  message: 'Filter #1 may be clogged',             // human-readable text
  timestamp: 1234567890,                            // from the snapshot that triggered the rule
  active: true                                      // false when the condition resolves
}
```

- **`id`** unique: essential for deduplication. Without it, a persistent condition generates spam of identical alerts.
- **`sensorIds`**: `AlertSystem.js` uses it to know which meshes to illuminate. Without this, there's no localized visual feedback.
- **`active`**: resolution mechanism. When the condition returns to normal range, the RuleEngine emits the same `id` with `active: false`. `AlertPanel.js` removes the alert; `AlertSystem.js` removes the overlay; `ColorMapper.js` returns to normal color.

### Decision 7 — Alert resolution flow ★

An alert is not a single fire event — it has a lifecycle. The RuleEngine evaluates on every tick and manages the active state of each rule internally:

```js
// RuleEngine maintains this internal record
const activeAlerts = new Map(); // id → alert object

// On each tick, for each rule:
if (conditionTriggered && !activeAlerts.has(id)) {
  const alert = { id, severity, sensorIds, message, timestamp, active: true };
  activeAlerts.set(id, alert);
  EventBus.emit(EVENTS.RULE_TRIGGERED, alert);
}

if (!conditionTriggered && activeAlerts.has(id)) {
  const resolved = { ...activeAlerts.get(id), active: false, timestamp };
  activeAlerts.delete(id);
  EventBus.emit(EVENTS.RULE_TRIGGERED, resolved); // same event, active: false
}
```

Using a single event (`RULE_TRIGGERED`) with `active: true/false` instead of two separate events simplifies consumer logic — they only need one listener that checks `alert.active`.

**Recovering alert state after UI restart:** `RuleEngine` exposes a `getActiveAlerts()` method that returns a copy of the internal map as an array. Any module that initializes after startup (or re-initializes after hot reload) can call this method to recover current state without waiting for the next tick.

### Decision 8 — Centralized event catalog ★

All EventBus event names live in a single exported `EVENTS` object. No module uses literal event strings — it always imports from this catalog. This makes typo errors detectable with grep and makes forks more readable.

```js
// src/core/events.js — source of truth for all system events
export const EVENT_CONTRACT_VERSION = '2';

export const EVENTS = {
  SENSOR_UPDATE:        'sensor:update',
  RULE_TRIGGERED:       'rule:triggered',
  MQTT_CONNECTING:      'mqtt:connecting',
  MQTT_CONNECTED:       'mqtt:connected',
  MQTT_ERROR:           'mqtt:error',
  MQTT_DISCONNECTED:    'mqtt:disconnected',
  EXPORT_STARTED:       'export:started',
  EXPORT_COMPLETE:      'export:complete',
  SCENARIO_CHANGED:     'scenario:changed',
  WEBHOOK_RESULT:       'webhook:result',
  KPIS_UPDATED:         'kpis:updated',
  DATA_SOURCE_CHANGED:  'datasource:changed',
  DATA_SOURCE_CLEARING: 'datasource:clearing',
  OPEN_MULTI_CHART:     'chart:open-multi',
};
```

The payload comment on each event is the contract. Rule: if a new module needs an event that doesn't exist, it adds it here first, **with its payload documented**. Never inline.

### Decision 9 — History buffer in SensorState ★

`SensorState` doesn't just save the last reading — it maintains a circular buffer of the last N snapshots. Buffer size is defined as a constant and never grows indefinitely.

360 snapshots × ~200 bytes per snapshot ≈ 72KB. Completely reasonable in the browser.

**Reset policy:** when the user changes data source (simulator → real MQTT or vice versa), `DataSourceManager` calls `SensorState.reset()` before activating the new source. This guarantees that `DataExporter` never exports mixed data from two different sources. `RuleEngine` also does `activeAlerts.clear()` at the same moment to avoid orphan alerts from the previous session.

### Decision 10 — SensorConfig validation in dev mode ★

`SensorConfig.js` is the most important contract in the repo — if someone forks and adds a sensor with a misspelled field, the error appears far from the source. A minimal dev-mode validator catches it at startup.

The validator only runs in `import.meta.env.DEV` — zero overhead in production. The error points to the exact sensor and missing field.

### Decision 11 — Initialization order in main.js ★

`main.js` orchestrates startup in an async `init()` function with explicit order:

1. **Scene** — renderer must exist before any mesh
2. **AnimationLoop** — starts after scene exists, before data arrives
3. **State and logic** — `SensorState`, `RuleEngine`, `KPIEngine`, `DataSourceManager`
4. **UI** — all EventBus subscriptions registered before the first tick
5. **StartupModal** — user explicitly chooses data source

Rule: any module added in a fork must initialize in step 4, **before** `StartupModal.show()`. This function is the only entry point.

### Decision 12 — UI state before first tick ★

Between `init()` startup and the arrival of the first tick (~500ms), `SensorState.readings` is `{}` and `SensorState.isReady()` returns `false`. Modules that read from `SensorState` must handle this explicitly:

- **`TelemetryPanel`**: shows `—` for each sensor until `isReady()` is `true`
- **`SceneUpdater`**: doesn't update mesh colors until first tick
- **`RuleEngine`**: doesn't evaluate rules if `isReady()` is `false`
- **`DataExporter`**: if `history` is empty, returns a valid file with 0 rows

### Decision 13 — ColorMapper vs AlertSystem priority ★

`ColorMapper` and `AlertSystem` both touch the color of 3D meshes, but with distinct responsibilities and **without conflict** because they operate on separate layers:

- **`ColorMapper`** modifies `material.color` directly based on sensor value. Applied every tick via `SceneUpdater`. This is the base color of the object.
- **`AlertSystem`** adds an independent overlay (via `emissiveIntensity`) to indicate active alert. Does not touch `material.color`.

Rule: `ColorMapper` never touches `emissive`. `AlertSystem` never touches `color`.

### Decision 14 — Correlations in the simulator ★

Without correlations between sensors, the `RuleEngine` never detects the process situations that justify its existence in the demo. The simulator implements a minimal correlations model based on real causal process relationships (flow drives chlorine dose, filter clogging drives turbidity breakthrough, etc.).

### Decision 15 — RuleEngine rule structure ★

Each rule is an object with a fixed shape:

```js
{
  id: 'filter_clogged_1',
  severity: 'warning',
  sensorIds: ['filter_1_dp', 'filtered_turbidity'],
  message: 'Filter #1 may be clogged — high DP with turbidity breakthrough',
  condition: (readings) =>
    readings.filter_1_dp > 150 && readings.filtered_turbidity > 0.5,
}
```

To add a rule in a fork, the developer only adds an object to the `RULES` array — they don't touch the evaluation logic or lifecycle.

### Decision 16 — NoiseGenerator API ★

Single function with internal state per `sensorId`. Internal state (accumulated phase) guarantees temporal smoothness — consecutive values don't jump abruptly:

```js
export function noise(sensorId, amplitude, speed = 0.03) // → [-amplitude, +amplitude]
export function resetNoise() // resets all phases
```

Each sensor has its own independent phase because it uses its `sensorId` as key. Without this, all sensors would oscillate in sync, which looks immediately artificial.

### Decision 17 — 3D scene visual composition ★

Y is the vertical axis. The plant extends in the XZ plane. All geometry is built at Y ≥ 0 (floor at Y = 0). Camera position: `set(0, 22, 30)`, looking at `(0, 0, 10)` — gives an approximate isometric view showing the whole plant.

### Decision 18 — MQTT topic structure and real payload format ★

The Adapter subscribes to **a single wildcard topic**. All sensors arrive in a single JSON message per publication. No per-sensor topic — that would require 10 subscriptions and the problem of reconstituting synchronized snapshots on the client.

Topic: `wtp/plant/{plantId}/sensors` — payload format identical to Worker payload (Decision 1). `SensorState.update()` receives the same object regardless of source.

### Decision 19 — DataSourceManager as state machine ★

A critical refactor to fix three problems: simulated data persisting after stopping simulation, auto-resume of simulation on MQTT disconnect, and simulation auto-starting on load.

`DataSourceManager` is a centralized state machine with three states: `none | simulation | mqtt`. It is the **only module** that starts, stops, and transitions between data sources. No other module starts the Worker or the MQTT adapter directly.

```js
DataSourceManager.startSimulation()   // none → simulation
DataSourceManager.stopSimulation()    // simulation → none
DataSourceManager.connectMQTT(cfg)    // none/simulation → mqtt
DataSourceManager.disconnectMQTT()   // mqtt → none
```

On every transition, it emits `DATA_SOURCE_CLEARING` first (all modules clear their state), then `DATA_SOURCE_CHANGED` with the new mode.

**Guarantees:**
- Simulation NEVER starts without explicit user action
- `MQTT_DISCONNECTED` / `MQTT_ERROR` do NOT resume simulation
- On source change, ALL previous state is cleared (readings, history, active alerts, KPIs, toolbar counters)

### Decision 20 — StartupModal — explicit data source choice ★

On first load, a modal blocks the dashboard until the user explicitly picks a data source. `SensorWorker` **never starts automatically**. This fixes the "data persists after refresh" problem and makes the data source state always explicit and intentional.

The modal is shown in step 5 of `init()`, after all modules are initialized. `DataSourceManager` handles the actual source start after user selection.

### Decision 21 — MultiChartPanel three-layer architecture ★

The multi-sensor analysis panel is built on a clean three-layer architecture:

- **Data layer**: `SensorState.getHistory()` + `AnalyticsEngine` (pure stateless functions)
- **State layer**: `ChartStore` (zoom, hover, active series, config) — observable store
- **Render layer**: `MultiChartPanel` (SVG rendering) + `SensorDetailModal`

This separation means the analytics engine can be tested independently, the store can be subscribed to from multiple views, and the render layer is purely reactive to state changes.

### Decision 22 — ChartStore observable store pattern ★

`ChartStore` manages all chart state without external libraries. The `subscribe(key, fn)` method returns an unsubscribe function:

```js
const off = ChartStore.subscribe('zoom', () => this._renderAllCharts());
// later: off() to clean up
```

State keys: `activeSeries`, `zoom`, `hover`, `config`. Each has specific setters with validation (e.g., zoom is clamped, minimum range enforced). `reset()` clears series/zoom/hover but preserves config (user's display preferences survive panel close/reopen).

### Decision 23 — AnalyticsEngine as pure stateless functions ★

All analytics logic lives in `src/charts/AnalyticsEngine.js` as pure exported functions. No side effects, no state, no EventBus references. Tree-shakeable.

```js
export function computeStats(values)          // mean, median, std, p95, ...
export function computeDerivative(history)    // rate of change in units/s
export function detectAnomalies(history, opts) // Z-score flagging
export function computeCorrelation(a, b)      // Pearson [-1, 1]
export function computeCorrelationMatrix(seriesMap)
export function lttbDownsample(data, n)       // Largest Triangle Three Buckets
export function computeTrend(history, opts)   // linear regression
export function compareWindows(a, b)          // before/after delta + significance
```

Pure functions mean: no cleanup needed, no init(), predictable behavior, easy to unit test.

### Decision 24 — Zoom as data-space fractions ★

The zoom window is stored as `{ startFrac, endFrac }` where both values are in `[0, 1]` — fractions of the full history array length.

This is the correct abstraction because:
- Different sensors have different history lengths. A single fraction works for all of them.
- Pan and zoom operations are simple arithmetic on fractions.
- Serializable to JSON config without losing meaning.

Pixel coordinates are **never stored** in ChartStore — only computed at render time.

### Decision 25 — Synchronized crosshair via direct DOM manipulation ★

When hover fraction changes, `ChartStore` notifies `MultiChartPanel` via subscription. The panel updates SVG crosshair elements **directly** (`setAttribute('x1', cx)`) instead of triggering a full chart re-render. This ensures smooth 60fps cursor movement without the cost of rebuilding SVG paths.

### Decision 26 — EventMarkers time-indexed store ★

`EventMarkers` is a lightweight store that captures timestamps of significant events:

- `RULE_TRIGGERED` with `active: true` → alert marker (amber/red by severity)
- `SCENARIO_CHANGED` → scenario marker
- `DATA_SOURCE_CLEARING` → clears all markers

`getInRange(startTs, endTs)` returns all markers in a timestamp range. Charts call this during render to draw vertical flag lines at the exact moments alerts fired. This enables instant visual correlation between sensor behavior and alert conditions — essential for post-incident analysis.

### Decision 27 — FinancialAnalytics as pure stateless functions ★

Identical pattern to Decision 23 (AnalyticsEngine). All financial metric logic lives in `src/utils/FinancialAnalytics.js` as six named exports with no side effects, no imports from `ui/` or `core/`:

```js
export function computeOEE(history, config)                        // → { oee, availability, performance, quality }
export function computeCostPerUnit(currentValue, analyticsConfig)  // → { costPerUnit, totalCostPerHour }
export function computeDegradation(history, config, analyticsConfig) // → { degrading, timeToThresholdSeconds, slope }
export function computeVolatility(history, analyticsConfig)        // → { currentStd, historicalStd, ratio, level }
export function computeSharpe(history, config, analyticsConfig)    // → { sharpe, mean, std, baseline }
export function computeEconomicImpact(currentValue, config, analyticsConfig) // → { inRange, impact2h, ... }
```

These functions are consumed in three separate modules (SensorDetailModal, KPIEngine, MultiChartPanel) without any shared state. The inputs are plain data; the outputs are plain objects. No cleanup, no `init()`, no subscriptions.

### Decision 28 — FinancialConfig observable singleton with localStorage persistence ★

Financial analytics configuration is user-facing (each sensor has different cost rates, baselines, and enabled metrics). A simple observable singleton covers the requirements without Redux or a state library:

```js
// FinancialConfig.js
FinancialConfig.load()                    // reads localStorage, deep-merges with DEFAULTS
FinancialConfig.get()                     // returns current config (always a valid object)
FinancialConfig.set(metricKey, paramKey, value)  // updates one param + persists + notifies
FinancialConfig.setEnabled(metricKey, enabled)   // toggles metric + persists + notifies
FinancialConfig.subscribe(fn)             // returns unsubscribe fn — same pattern as ChartStore
FinancialConfig.reset()                   // restores DEFAULTS + persists + notifies
```

`load()` is idempotent — called in every consumer's `init()`. Deep-merge with `DEFAULTS` guarantees forward compatibility: new config keys added in future versions appear automatically with their default values.

Storage key: `wtp_financial_config`. Size: ~300 bytes JSON. No quota risk.

### Decision 29 — Shared DOM renderer for financial config UI ★

The financial config form appears in two places: the SensorDetailModal's inline ⚙ panel and the ConfigModal's `<details>` section. Without a shared renderer, both would have diverged in markup and behavior within a week of the first fork.

`renderFinancialConfigUI(container)` in `src/utils/renderFinancialConfigUI.js` generates the full form into any container element. Both panels call it identically. The function reads `FinancialConfig.get()` to populate current values and writes back via `FinancialConfig.set()` on input events.

CSS is injected once via `injectFinancialConfigStyles()` with an `id` guard — calling it multiple times is safe.

This pattern generalizes: any future config section that appears in multiple panels should use the same shared renderer approach.

---

## Sensors — Water Treatment Plant

10 sensors with direct binding to 3D scene objects, following the real process flow:

| ID | Name | Type | Normal range | Warning | Danger | Process stage |
| --- | --- | --- | --- | --- | --- | --- |
| `inlet_flow` | Inlet Flow Rate | m³/h | 50–200 | <40 or >220 | <20 or >250 | Intake |
| `raw_turbidity` | Raw Water Turbidity | NTU | 1–10 | 10–50 | >50 | Intake |
| `coag_ph` | Coagulation pH | pH | 6.5–7.5 | 6.0–6.5 / 7.5–8.0 | <6.0 or >8.0 | Coagulation |
| `filter_1_dp` | Filter #1 Differential Pressure | mbar | 20–150 | 150–200 | >200 | Filtration |
| `filter_2_dp` | Filter #2 Differential Pressure | mbar | 20–150 | 150–200 | >200 | Filtration |
| `filtered_turbidity` | Filtered Water Turbidity | NTU | 0.1–0.5 | 0.5–1.0 | >1.0 | Post-filtration |
| `chlorine_dose` | Chlorine Dose | mg/L | 1.0–3.0 | 0.5–1.0 / 3.0–4.0 | <0.5 or >4.0 | Chlorination |
| `residual_chlorine` | Residual Chlorine | mg/L | 0.2–1.0 | 0.1–0.2 / 1.0–1.5 | <0.1 or >1.5 | Distribution |
| `tank_level` | Clearwell Tank Level | % | 40–90 | 20–40 / 90–95 | <20 or >95 | Storage |
| `outlet_pressure` | Distribution Pressure | bar | 3.0–6.0 | 2.0–3.0 / 6.0–7.0 | <2.0 or >7.0 | Distribution |

---

## AI Architecture (simplified — two levels)

**Level 1 — RuleEngine (MVP, always active, no download)**

- Evaluates sensor thresholds in real time
- Detects process correlations evaluating **complete snapshots**: high filtered turbidity + high differential pressure = clogged filter
- Detects chlorination anomalies: flow rises but chlorine dose doesn't scale → disinfection deficit
- Generates structured alerts with probable cause following the Decision 6 contract
- Manages alert lifecycle (active / resolved) per Decision 7
- Zero latency, zero weight, zero download

**Level 2 — WebLLM + TinyLlama (V2.0, opt-in)**

- Separate branch in the repo (`feature/ai-advisor`)
- User clicks "Ask AI"
- TinyLlama (~700MB) downloaded and cached in IndexedDB on first use
- Generates natural language diagnosis of process state
- Runs in `ai.worker.js` — never blocks the render

---

## File structure

```
digital-twin-water/
│
├── index.html
├── vite.config.js
├── package.json
├── README.md
├── CONTRIBUTING.md
├── design.md
├── progress.md
├── product.md
├── mcp-server.js              ← MCP server for Claude Desktop integration
├── mcp-bridge-server.js       ← Bridge server for MCP
│
├── .github/workflows/deploy.yml
│
├── public/
│   ├── favicon.svg, manifest.json, sw.js
│   └── icons/
│
├── docs/
│   ├── mqtt-production.md
│   ├── claude-desktop-setup.md
│   └── cover.png, cover_2.png, ...
│
└── src/
    ├── main.js                 ← entry point, explicit init() order
    ├── style.css
    │
    ├── core/
    │   ├── SceneManager.js
    │   ├── ModelFactory.js
    │   ├── AnimationLoop.js
    │   ├── EventBus.js
    │   ├── DataSourceManager.js  ← state machine: none|simulation|mqtt ★
    │   └── events.js             ← event catalog + EVENT_CONTRACT_VERSION ★
    │
    ├── sensors/
    │   ├── SensorConfig.js       ← 10 WTP sensors + ranges ★
    │   ├── SensorState.js        ← singleton: state + circular buffer ★
    │   ├── SensorSceneMap.js     ← sensor ID → mesh name binding ★
    │   ├── SensorWorker.js
    │   ├── sensor.worker.js      ← simulation with causal correlations ★
    │   ├── MQTTAdapter.js
    │   ├── RuleEngine.js         ← RULES[] + evaluation + activeAlerts ★
    │   └── KPIEngine.js
    │
    ├── scene/
    │   ├── ColorMapper.js
    │   ├── AlertSystem.js
    │   └── SceneUpdater.js
    │
    ├── charts/
    │   ├── AnalyticsEngine.js    ← pure stateless analytics functions ★
    │   ├── ChartStore.js         ← observable store: zoom/hover/series ★
    │   └── EventMarkers.js       ← time-indexed alert/scenario markers ★
    │
    ├── ui/
    │   ├── TelemetryPanel.js
    │   ├── AlertPanel.js
    │   ├── IncidentPanel.js
    │   ├── KPIPanel.js
    │   ├── MiniMap.js
    │   ├── MobileTabBar.js
    │   ├── Toolbar.js
    │   ├── ConfigModal.js
    │   ├── SensorDetailModal.js  ← v2: zone-colored segments, stale detection ★
    │   ├── MQTTPanel.js
    │   ├── PayloadMapperPanel.js
    │   ├── WebhookPanel.js
    │   ├── StartupModal.js       ← explicit data source selection ★
    │   └── MultiChartPanel.js    ← multi-sensor analysis panel ★
    │
    └── utils/
        ├── NoiseGenerator.js
        ├── DataExporter.js
        ├── MCPBridge.js
        ├── PayloadMapper.js
        ├── SparkplugParser.js
        ├── WebhookManager.js
        ├── FinancialAnalytics.js     ← six pure financial metric functions ★
        ├── FinancialConfig.js        ← localStorage-persisted observable singleton ★
        └── renderFinancialConfigUI.js ← shared config UI renderer ★
```

> ★ Critical architecture files or new in this iteration.

---

## Build phases

```
PHASE 1 — Contracts and data first
  events.js           → EVENTS catalog + payloads + EVENT_CONTRACT_VERSION ★ FIRST
  SensorConfig.js     → 10 WTP sensors, ranges, dev mode validator ★
  SensorState.js      → singleton + circular buffer + isReady() + reset() ★
  SensorSceneMap.js   → sensor → mesh binding (contract before ModelFactory) ★
  NoiseGenerator.js   → smoothed reusable noise
  sensor.worker.js    → simulation with causal correlations + invalid value policy ★
  EventBus.js         → notifications without coupling

PHASE 2 — Scene that reacts to data
  SceneManager.js     → Three.js setup
  ModelFactory.js     → procedural WTP plant (MeshStandardMaterial on all meshes) ★
  AnimationLoop.js    → RAF loop
  ColorMapper.js      → value → material.color (never emissive)
  AlertSystem.js      → overlay via emissiveIntensity (never color) ★
  SceneUpdater.js     → coordinates ColorMapper and AlertSystem

PHASE 3 — UI
  TelemetryPanel.js   → checks isReady(), shows "—" until first tick ★
  AlertPanel.js       → calls getActiveAlerts() in init() ★
  Toolbar.js          → controls + MQTT connection state (listens MQTT_* from init) ★
  MiniMap.js          → Leaflet

PHASE 4 — Adapter + RuleEngine + polish
  RuleEngine.js       → RULES[] + evaluation + getActiveAlerts() ★
  MQTTAdapter.js      → simulated ↔ real broker + lifecycle events ★
  DataExporter.js     → JSON/CSV from SensorState.history ★
  DataSourceManager.js → state machine for data source lifecycle ★
  StartupModal.js     → explicit source selection ★
  main.js             → explicit init() + error screen ★

PHASE 5 — Launch
  README with GIF before title
  Demo deploy (Vercel or GitHub Pages — < 10s load)
  GitHub Actions for automatic deploy
  HackerNews post (Show HN)

PHASE 6 — Advanced analytics (V1.4)
  AnalyticsEngine.js  → pure stateless analytics ★
  ChartStore.js       → observable store ★
  EventMarkers.js     → time-indexed marker store ★
  SensorDetailModal v2 → zone-colored segments, stale detection, history table ★
  MultiChartPanel.js  → multi-sensor comparison panel ★

PHASE 6.5 — Financial analytics (V1.5)
  FinancialAnalytics.js      → 6 pure functions: OEE, cost/unit, degradation, volatility, Sharpe, economic impact ★
  FinancialConfig.js         → localStorage-persisted singleton with subscribe/notify pattern ★
  renderFinancialConfigUI.js → shared config renderer used by SensorDetailModal + ConfigModal ★
  SensorDetailModal          → ⚙ inline financial config panel, history-length memoization ★
  KPIEngine.js               → 4 financial KPIs always present: sessionOEE, avgCostPerM3, sessionCostTotal, financialRiskScore ★
  KPIPanel.js                → Financial section (4 cards), ⚙ Configure → ConfigModal ★
  ConfigModal.js             → Financial <details> section, openAtSection(id) method ★
  MultiChartPanel.js         → € Cost overlay, ≈ Corr sidebar section, ⚡ Impact combined chart ★

PHASE 7 — V2.0 (post-traction)
  feature/ai-advisor branch
  ai.worker.js + WebLLM + TinyLlama
  AIPanel.js
```

---

## Distribution strategy

**Launch day (Phase 5):**

- **HackerNews Show HN** — Monday or Tuesday morning (EU/US East time). Title: `Show HN: Browser-only digital twin of a water treatment plant (Three.js + MQTT)`. Potential: 200–500 stars in 48h if the demo is impressive.
- **Reddit r/webdev + r/threejs** — same day, more visual version, with GIF.
- **DEV.to** — technical article: "How I built a water treatment digital twin that runs entirely in the browser". Long-term organic traffic.
- **Twitter/X** — GIF of the working demo. No long text. The GIF does the work.

**Necessary condition for this to work: the demo must load in under 10 seconds.** Without 700MB of WebLLM, this is trivially achievable.

---

## MOSCOW

### MUST HAVE — Functional MVP

- 3D viewer with procedural WTP plant model
- 10 sensors simulated in Worker thread with causal correlations
- `events.js` with centralized catalog + `EVENT_CONTRACT_VERSION`
- `SensorState.js` as singleton with `isReady()`, circular buffer, `reset()`
- `RuleEngine` with `RULES[]` + `condition()` + `getActiveAlerts()`
- `DataSourceManager` as state machine — never auto-starts Worker
- `StartupModal` — user explicitly picks data source on load
- `AlertSystem` overlay via `emissiveIntensity` (separate layer from `ColorMapper`)
- `MQTTAdapter` pluggable to real broker, observable lifecycle
- Visible error strategy in `init().catch()` — never blank screen

### SHOULD HAVE — V1.x

- Leaflet map with municipal plant location
- Historical data with per-sensor charts (`SensorState.getHistory()`)
- JSON/CSV export of time series
- Incident simulation mode — 5 fault scenarios, 30s countdown
- Trend detection in RuleEngine (using history buffer)
- Webhook alerts to Slack/Discord/n8n
- Payload mapper for arbitrary MQTT formats
- Sparkplug B decode
- Process KPIs
- Claude Desktop MCP integration
- Multi-sensor analysis panel with analytics engine
- Financial analytics module (OEE, cost/unit, degradation, volatility, Sharpe, economic impact)
- Economic overlay layers in MultiChartPanel (€ Cost, ≈ Corr, ⚡ Impact)
- Financial KPIs in KPIPanel + ConfigModal financial section

### COULD HAVE — V2.0

- WebLLM + TinyLlama on `feature/ai-advisor` branch
- Multi-plant Leaflet map (distribution network)
- Visual themes (dark ops / light reporting)
- User's own GLTF model loading

### WON'T HAVE

- Own backend
- Database
- Authentication
- WebGPU (premature for production)
- WebLLM in MVP (moved to V2.0)
- Mutual TLS in MQTTAdapter (requires proxy, outside starter kit scope)

---

## Key decisions summary

| Decision | Rejected alternative | Reason |
| --- | --- | --- |
| Water Treatment Plant | Generic factory | 0 lightweight competitors, loyal audience, universally understandable sensors |
| WebLLM in V2.0 | WebLLM in MVP | 700MB download + postMessage overhead destroy demo conversion rate |
| Deterministic RuleEngine | Everything with LLM | Process correlations don't need generative AI. Zero latency, zero weight |
| DataSourceManager state machine | Direct Worker/MQTT coupling | Single orchestrator, no auto-resume bugs, explicit user intent |
| StartupModal | Auto-start simulation | Simulation NEVER starts without user action — data is always intentional |
| Zoom as data-space fractions | Pixel coordinates | Works across sensors with different history lengths; serializable |
| ChartStore observable pattern | Redux/MobX | No external dependencies; custom pub-sub is 9KB total |
| AnalyticsEngine pure functions | Stateful analytics class | No cleanup needed, tree-shakeable, trivially testable |
| EventMarkers time-indexed store | Query RuleEngine history | Decoupled from rule evaluation; cleared on source change |
| Synchronized crosshair via direct DOM | Full re-render on hover | Smooth 60fps cursor movement without SVG path rebuild cost |
| Vite | Next.js | Next.js adds nothing without a server; Three.js needs `window`, forces `ssr:false` everywhere |
| ES Modules + JS objects | Web Components | Shadow DOM adds complexity without benefit; objects are more readable and forkable |
| Procedural model | GLTF from Sketchfab | Ambiguous licenses; no external deps; more educational for forks |
| FinancialAnalytics pure functions | Stateful class | Identical pattern to AnalyticsEngine — no side effects, tree-shakeable, trivially testable |
| FinancialConfig observable singleton | Prop drilling / Redux | localStorage persistence + subscribe/notify in 60 lines; zero external deps |
| Shared renderFinancialConfigUI renderer | Duplicated DOM in each panel | Single source of truth for config UI; called identically from SensorDetailModal and ConfigModal |
| Financial KPIs always-present in KPIS_UPDATED | Optional keys | KPIPanel never guards against missing keys; value is 0 when metric disabled, never absent |

---

*Update this document every time an architecture decision changes, a module is added, or scope is modified.*
