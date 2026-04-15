# PROGRESS.md — Implementation Status

> Read together with `product.md` and `design.md`.
> Update when closing each phase or making significant changes.

---

## Overall status

| Phase | Name | Status |
|---|---|---|
| **Phase 1** | Contracts and data first | ✅ Complete |
| **Phase 2** | Scene that reacts to data | ✅ Complete |
| **Phase 3** | UI | ✅ Complete |
| **Phase 4** | Adapter + RuleEngine + polish | ✅ Complete |
| **Phase 5** | Launch | ✅ Complete |
| **V1.1** | Historical charts, incident mode, trend detection | ✅ Complete |
| **V1.2** | Webhooks, Payload mapper | ✅ Complete |
| **V1.3** | Sparkplug B, KPIs, MCP server | ✅ Complete |
| **V1.4** | DataSourceManager, StartupModal, SensorDetailModal v2, MultiChartPanel | ✅ Complete |
| **V2.0** | AI Advisor (WebLLM + TinyLlama) | ⬜ Pending |

---

## Current file structure

```
digital-twin-water/
├── README.md
├── product.md
├── progress.md
├── design.md
├── index.html
├── vite.config.js                        base: '/digital-twin-water/'
├── server.js                             Node.js MQTT publisher for testing
├── mcp-server.js                         MCP server for Claude Desktop
├── mcp-bridge-server.js                  browser → mcp-state.json bridge
├── mcp-state.json                        dashboard state (generated at runtime)
├── .github/workflows/deploy.yml
├── docs/
│   ├── mqtt-production.md
│   └── claude-desktop-setup.md
└── src/
    ├── main.js
    ├── core/
    │   ├── events.js                     EVENT_CONTRACT_VERSION = '2'
    │   ├── EventBus.js
    │   ├── SceneManager.js
    │   ├── ModelFactory.js
    │   ├── AnimationLoop.js
    │   └── DataSourceManager.js          state machine: none|simulation|mqtt ★ V1.4
    ├── sensors/
    │   ├── SensorConfig.js
    │   ├── SensorState.js                + getTrend()
    │   ├── SensorSceneMap.js
    │   ├── sensor.worker.js              + incident scenarios
    │   ├── SensorWorker.js               + scenario()
    │   ├── RuleEngine.js                 + 4 trend rules
    │   ├── MQTTAdapter.js                + PayloadMapper + SparkplugParser
    │   └── KPIEngine.js
    ├── scene/
    │   ├── ColorMapper.js
    │   ├── AlertSystem.js
    │   └── SceneUpdater.js
    ├── charts/                           ★ new in V1.4
    │   ├── AnalyticsEngine.js            pure stateless analytics functions
    │   ├── ChartStore.js                 observable store: zoom/hover/series
    │   └── EventMarkers.js               time-indexed alert/scenario markers
    ├── ui/
    │   ├── TelemetryPanel.js
    │   ├── AlertPanel.js                 + History section
    │   ├── Toolbar.js
    │   ├── MiniMap.js
    │   ├── MQTTPanel.js
    │   ├── ConfigModal.js
    │   ├── SensorDetailModal.js          v2: zone-colored chart, stale detection ★ V1.4
    │   ├── IncidentPanel.js
    │   ├── WebhookPanel.js
    │   ├── PayloadMapperPanel.js
    │   ├── KPIPanel.js
    │   ├── MobileTabBar.js
    │   ├── StartupModal.js               explicit data source selection ★ V1.4
    │   └── MultiChartPanel.js            multi-sensor analysis panel ★ V1.4
    └── utils/
        ├── NoiseGenerator.js
        ├── DataExporter.js
        ├── WebhookManager.js
        ├── PayloadMapper.js
        ├── SparkplugParser.js
        └── MCPBridge.js
```

---

## Phases 1–5 — Complete

Simulation Worker with causal correlations, Three.js 3D scene (12 functional meshes), ColorMapper + AlertSystem (separate layers), RuleEngine with active/resolved lifecycle, MQTTAdapter, GitHub Pages deploy, server.js for HiveMQ Cloud.

---

## V1.1 — Complete ✅

**Historical charts** — `SensorDetailModal.js`: click on sensor row → modal with live SVG chart of the last 3 minutes, threshold reference lines, min/avg/max stats updated every 500ms.

**Incident simulation mode** — `IncidentPanel.js` + `sensor.worker.js`: floating panel with 5 scenarios (filter clog, critical, chlorine deficit, low tank, pH anomaly). 30s per scenario with countdown, automatic reset.

**Trend detection** — `SensorState.getTrend(sensorId, windowSeconds)`: linear regression over the history buffer. 4 new rules in RuleEngine: `filter_1_dp_rising`, `tank_draining`, `inlet_flow_sudden_drop`, `filtered_turbidity_rising`.

---

## V1.2 — Complete ✅

**Webhooks** — `WebhookManager.js` + `WebhookPanel.js`:
POST to URLs configured from the UI when alerts activate.
Events: `alert.danger`, `alert.warning`, `alert.resolved`.
Critical CORS fix: `Content-Type: text/plain` avoids the OPTIONS preflight
that was blocking the body. Verified in production with webhook.site, Slack,
Discord, n8n. Config in `localStorage` (key `wtp_webhooks`).

**Payload mapper** — `PayloadMapper.js` + `PayloadMapperPanel.js`:
Transforms any MQTT format to the internal format. Modes: auto-detect
(Sparkplug-like arrays, flat fields, nested `data`), flat, custom with
dot notation (`data.process.flow` → `inlet_flow`). Integrated in
`MQTTAdapter._handleMessage()`. Config in `localStorage` (key `wtp_payload_map`).

---

## V1.3 — Complete ✅

### Sparkplug B parser

**`src/utils/SparkplugParser.js`**
Manual Protobuf decoder for Sparkplug B with no external dependencies (~150 lines).
Supports all numeric types (Int8–Int64, UInt8–UInt64, Float, Double, Boolean).
Auto-detects by topic (`spBv1.0/.../DDATA/...`) in `MQTTAdapter`.
Compatible with Ignition, Cirrus Link, and any Sparkplug B device.

### Process KPIs

**`src/sensors/KPIEngine.js`**
Calculates derived metrics from `SensorState.history` every 5 seconds.
Emits `EVENTS.KPIS_UPDATED`.

| KPI | Description |
|---|---|
| `throughput` | Estimated m³ treated in the current window |
| `avgInletFlow` | Average flow rate in m³/h |
| `timeNormal` | % of time in normal operation |
| `timeInWarning` | % of time in warning state |
| `timeInDanger` | % of time in danger state |
| `backwashCount` | Detected backwashes (drops >80 mbar in filter_1_dp) |
| `chlorinationEff` | % of ticks with residual chlorine in normal range |
| `chlorineKg` | Estimated chlorine consumed in kg |
| `alertsTriggered` | Alerts activated in the session |
| `sessionDuration` | Session duration in seconds |

**`src/ui/KPIPanel.js`**
Modal accessible from "📊 KPIs" in the topbar.

### MCP server for Claude Desktop

**`mcp-server.js`** — MCP server (stdio JSON-RPC) with 6 tools:

| Tool | Description |
|---|---|
| `get_plant_status` | Full summary: readings + alerts + KPIs |
| `get_sensor_readings` | Current values, filterable by sensor ID |
| `get_active_alerts` | Active alerts filterable by severity |
| `get_kpis` | Process KPIs formatted for reading |
| `get_sensor_trend` | Trend analysis with linear regression |
| `get_alert_history` | Last resolved alerts with duration |

Full flow: `Dashboard → MCPBridge → POST localhost:3001/state → mcp-bridge-server writes mcp-state.json → mcp-server.js reads mcp-state.json → Claude Desktop calls tools via MCP protocol`

---

## V1.4 — Complete ✅

### Architecture refactor: DataSourceManager + StartupModal

**Problem solved:** three separate bugs — simulated data persisting after stopping simulation, auto-resume of simulation on MQTT disconnect, and simulation auto-starting on page load.

**`src/core/DataSourceManager.js`** — centralized state machine with three states: `none | simulation | mqtt`.
- Is the **only module** that starts/stops data sources
- On every transition: emits `DATA_SOURCE_CLEARING` first (all modules clear state), then `DATA_SOURCE_CHANGED` with new mode
- Guarantees simulation NEVER starts without explicit user action
- `MQTT_DISCONNECTED` / `MQTT_ERROR` do NOT resume simulation
- All previous state is cleared on source change (readings, history, alerts, KPIs, toolbar counters)

**`src/ui/StartupModal.js`** — modal that blocks dashboard on first load until user explicitly picks a data source. `SensorWorker` never starts automatically.

**Modified modules:** `AlertPanel` (`_clearing` flag prevents ghost history items), `KPIEngine` (resets on `DATA_SOURCE_CLEARING`), `IncidentPanel` (clears on source change), `Toolbar` (resets alert counter), `main.js` (removed all direct Worker start calls).

**`vite.config.js`** fix: added `optimizeDeps: { include: ['mqtt'] }` to resolve the "mqtt package not found" error that appeared after the refactor (dynamic `import('mqtt')` in the Worker requires explicit pre-bundling declaration).

---

### SensorDetailModal v2 — complete rewrite

**`src/ui/SensorDetailModal.js`**

- **Zone-colored line segments**: consecutive same-state points grouped into runs (green/amber/red). Bridge point at transitions for seamless connection. Same technique as Grafana state timelines.
- **Zone background bands**: colored rectangle bands behind the chart for each threshold zone (normal/warning/danger) — visual context without needing to read reference lines.
- **Hover crosshair + tooltip**: SVG crosshair line + dot that follows the cursor. Tooltip shows value, time ago, and state — all color-coded to the zone.
- **Stale feed detection**: checks `Date.now() - SensorState.lastTimestamp > 2500ms`. Shows pulsing amber "Feed paused" banner over the chart and dims the SVG to 40% opacity.
- **Collapsible history table**: last 60 entries, newest first, high-precision values (4 decimal places), color-coded state per row. Toggle with "▾ History" button.
- **"⊞ Compare" button**: opens MultiChartPanel pre-loaded with the current sensor.

---

### AnalyticsEngine — pure stateless functions

**`src/charts/AnalyticsEngine.js`**

All analytics logic as pure exported functions. No side effects, no state, no EventBus.

| Function | Description |
|---|---|
| `computeStats(values)` | mean, median, std, variance, min, max, range, p95, n |
| `computeDerivative(history)` | rate of change in units/s |
| `detectAnomalies(history, opts)` | Z-score flagging (default threshold: 2.5σ) |
| `detectPeaks(values, opts)` | local min/max with minimum prominence |
| `computeCorrelation(a, b)` | Pearson correlation coefficient [-1, 1] |
| `computeCorrelationMatrix(seriesMap)` | all-pairs correlation matrix |
| `describeCorrelation(r)` | `{ label, strength, sign }` |
| `lttbDownsample(data, n)` | Largest Triangle Three Buckets — shape-preserving downsampling |
| `computeTrend(history, opts)` | linear regression: slope, direction, R² |
| `formatTrend(trend, unit)` | human-readable: "↗ +2.4 m³/h·s" |
| `compareWindows(a, b)` | before/after delta: meanDelta, meanDeltaRel, stdDelta, significant |

---

### ChartStore — observable store

**`src/charts/ChartStore.js`**

Central state store for the multi-chart panel. No external dependencies.

```js
ChartStore.activeSeries       // [{ sensorId, visible, color }]
ChartStore.zoomWindow         // { startFrac, endFrac } ∈ [0,1]
ChartStore.hoverFrac          // null | number
ChartStore.config             // { chartType, scaleType, showDerivative, showAnomalies, ... }

ChartStore.subscribe(key, fn) // returns unsubscribe function
ChartStore.addSeries(id)      // false if already present or at maxSeries (6)
ChartStore.removeSeries(id)
ChartStore.toggleSeries(id)
ChartStore.setZoom(start, end) // clamped, min range 0.05
ChartStore.resetZoom()
ChartStore.zoomAround(centerFrac, factor)
ChartStore.panBy(deltaFrac)
ChartStore.setHoverFrac(frac)
ChartStore.clearHover()
ChartStore.setConfig(key, value)
ChartStore.reset()            // clears series/zoom/hover, preserves config
```

`SERIES_PALETTE`: 8 distinct colors for up to 6 active sensors.

---

### EventMarkers — time-indexed marker store

**`src/charts/EventMarkers.js`**

Captures alert and scenario timestamps for annotation on charts.

- `RULE_TRIGGERED` with `active: true` → alert marker (amber=warning, red=danger)
- `SCENARIO_CHANGED` → scenario marker
- `DATA_SOURCE_CLEARING` → `clear()`
- Max 120 events (circular, oldest removed on overflow)
- `getInRange(startTs, endTs)` → events in timestamp range
- `count()` → total stored markers
- Initialized in `main.js` step 4

---

### MultiChartPanel — multi-sensor analysis panel

**`src/ui/MultiChartPanel.js`**

Opened via `EventBus.emit(EVENTS.OPEN_MULTI_CHART, { sensorIds? })` or via "⊞ Compare" button in topbar / SensorDetailModal.

**Panel**: `min(1160px, 100vw-32px)` × `min(740px, 100vh-48px)`, z-index 200, animated entrance.

**Layout**: 200px fixed sidebar + flex-1 charts area.

**Per-chart card:**
- Header with sensor name, unit, state badge, current value (with state color), trend direction
- SVG chart: zone bands + reference lines + zone-colored segments + derivative overlay + anomaly markers + event marker flags
- Minimap navigator (28px): full history overview, drag/click to pan zoom window
- Stats bar: min, avg, max, σ, n

**Synchronized crosshair**: hover over any chart updates SVG crosshair elements on all charts via direct `setAttribute` — no re-render, smooth 60fps.

**Zoom/pan**: scroll wheel zooms around cursor position, drag pans. Zoom stored as data-space fractions [0,1] — works across sensors with different history lengths.

**Time window buttons**: 30s / 1m / 2m / All in the header. Uses actual timestamps for accurate fraction computation.

**Event markers**: vertical dashed lines with small flag triangles at alert timestamps. Amber for warning, red for danger. Drawn from `EventMarkers.getInRange(startTs, endTs)`.

**Analytics sidebar:**
- Per-sensor stats: μ, σ, min, max, p95, n, trend arrow
- **Before/After comparison**: shown when zoom window < 95% of history. Splits window at midpoint, runs `compareWindows()`, shows mean delta, percentage change, and "↑ rising / ↓ falling / → stable" verdict per sensor
- **Pearson correlations**: all visible pairs when ≥2 sensors active; color-coded by strength and direction

**Export:**
- CSV: all visible series with timestamps and datetime strings
- Clipboard: TSV format for spreadsheet paste
- JSON config: activeSeries + zoomWindow + config snapshot
- PNG snapshot: renders all chart SVGs to a 2× DPI canvas with sensor names and current values, downloads as timestamped PNG

**CSS**: all injected via `<style id="mc-styles">` in `_injectStyles()`, no external dependencies.

---

## V2.0 — Pending

Separate branch `feature/ai-advisor`:
- `ai.worker.js` — TinyLlama via WebLLM (~700MB, opt-in, cached in IndexedDB)
- `AIPanel.js` — natural language diagnosis of process state

Do not merge into `main` until sufficient traction in the repo.

---

## Current events catalog (`src/core/events.js`)

```
EVENT_CONTRACT_VERSION = '2'

SENSOR_UPDATE        — complete snapshot every 500ms
RULE_TRIGGERED       — alert active/resolved (active: true/false)
MQTT_CONNECTING      — user requested connection
MQTT_CONNECTED       — broker confirmed session
MQTT_ERROR           — connection failure
MQTT_DISCONNECTED    — session terminated
EXPORT_STARTED       — user clicked Export CSV
EXPORT_COMPLETE      — export completed
SCENARIO_CHANGED     — incident scenario activated/cancelled
WEBHOOK_RESULT       — webhook send result
KPIS_UPDATED         — KPIs recalculated (every 5s)
DATA_SOURCE_CHANGED  — data source mode changed (payload: { mode })
DATA_SOURCE_CLEARING — about to change source, clear all state
OPEN_MULTI_CHART     — open MultiChartPanel (payload: { sensorIds? })
```

---

## Files NOT to touch without good reason

| File | Why |
|---|---|
| `src/core/events.js` | If a payload is modified, bump `EVENT_CONTRACT_VERSION` |
| `src/core/DataSourceManager.js` | Single orchestrator for all data source transitions |
| `src/sensors/SensorConfig.js` | Ranges affect RuleEngine, TelemetryPanel, ColorMapper, KPIEngine |
| `src/sensors/SensorSceneMap.js` | Names must match ModelFactory EXACTLY |
| `src/sensors/SensorState.js` | Shared singleton — `getTrend()` and `history` are part of the contract |
| `src/scene/ColorMapper.js` | `getSensorState()` used by TelemetryPanel, SensorDetailModal, KPIEngine |
| `src/utils/PayloadMapper.js` | Changes affect ALL incoming MQTT messages |
| `src/utils/SparkplugParser.js` | Protobuf decode is fragile — don't touch without knowing the wire format |
| `src/charts/ChartStore.js` | Observable contract — subscribers depend on key names and setter behavior |
| `src/charts/AnalyticsEngine.js` | Pure function signatures — changing them breaks MultiChartPanel callers |
