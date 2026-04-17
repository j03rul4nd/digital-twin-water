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
| **V1.5** | Financial analytics module, KPI financial KPIs, economic chart layers | ✅ Complete |
| **V1.6** | Replay mode — session history scrubber | ✅ Complete |
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
    │   ├── events.js                     EVENT_CONTRACT_VERSION = '3'
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
    │   ├── SensorDetailModal.js          v2: zone-colored chart, stale detection ★ V1.4 + financial config panel ★ V1.5
    │   ├── IncidentPanel.js
    │   ├── WebhookPanel.js
    │   ├── PayloadMapperPanel.js
    │   ├── KPIPanel.js
    │   ├── MobileTabBar.js
    │   ├── StartupModal.js               explicit data source selection ★ V1.4
    │   └── MultiChartPanel.js            multi-sensor analysis panel ★ V1.4 + economic layers ★ V1.5
    └── utils/
        ├── NoiseGenerator.js
        ├── DataExporter.js
        ├── WebhookManager.js
        ├── PayloadMapper.js
        ├── SparkplugParser.js
        ├── MCPBridge.js
        ├── FinancialAnalytics.js         pure functions: OEE, cost/unit, degradation, volatility, Sharpe, impact ★ V1.5
        ├── FinancialConfig.js            localStorage-persisted config singleton ★ V1.5
        └── renderFinancialConfigUI.js    shared config UI renderer ★ V1.5
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

## V1.5 — Complete ✅

### Financial analytics module

**`src/utils/FinancialAnalytics.js`** — pure stateless functions, no side effects, no UI/core imports.

| Function | Description |
|---|---|
| `computeOEE(history, config)` | Availability × Performance × Quality; returns `{ oee, availability, performance, quality }` |
| `computeCostPerUnit(value, cfg)` | Energy + chemical + labor cost per hour at current flow; returns `{ totalCostPerHour, breakdown }` |
| `computeDegradation(history, config, cfg)` | Least-squares regression → time-to-danger threshold in seconds |
| `computeVolatility(history, cfg)` | Coefficient of variation (σ/μ) over the history window |
| `computeSharpe(history, config, cfg)` | Sharpe-like ratio: (mean − target) / σ, measures process stability relative to normal range |
| `computeEconomicImpact(value, config, cfg)` | Deviation × costPerDeviationUnit/h × 2h = `impact2h`; `inRange` flag |
| `formatDuration(seconds)` | Human-readable: `"14m"`, `"2.3h"`, `"1.4d"` |

**`src/utils/FinancialConfig.js`** — localStorage-persisted singleton (key: `wtp_financial_config`).
- Deep-merges with `DEFAULTS` on load
- Metrics: `oee`, `costPerUnit`, `degradation`, `volatility`, `sharpe`, `economicImpact`
- Each metric has an `enabled` boolean + numeric parameters
- `subscribe(fn)` returns an unsubscribe function — observer pattern, no EventBus dependency
- `set(metricKey, paramKey, value)` → persist → notify all subscribers

**`src/utils/renderFinancialConfigUI.js`** — shared DOM renderer.
- `renderFinancialConfigUI(container)`: generates checkboxes + numeric inputs for all metrics; wires events to `FinancialConfig.set()` / `setEnabled()`; "↺ Reset to defaults" button
- `injectFinancialConfigStyles()`: injects CSS once into `<head>`; safe to call multiple times

---

### SensorDetailModal — financial config panel

**`src/ui/SensorDetailModal.js`** updated:
- Imports `FinancialAnalytics` functions and `FinancialConfig` instead of inline constants
- ⚙ toggle button in modal header opens/closes an inline `#sd-financial-config-panel`
- Re-renders analytics section whenever `FinancialConfig` changes (via subscribe)
- Memoized on `history.length` — only recalculates when new data arrives

---

### KPIEngine — financial KPIs

**`src/sensors/KPIEngine.js`** updated — four new KPIs always present in `KPIS_UPDATED` (value `0` when the metric is disabled):

| KPI | Description |
|---|---|
| `sessionOEE` | OEE over `inlet_flow` for the full session window |
| `sessionCostTotal` | Sum of `totalCostPerHour × (0.5/3600)` for every 500ms tick |
| `avgCostPerM3` | `sessionCostTotal / throughput` |
| `financialRiskScore` | Mean `impact2h` of out-of-range sensors in the last snapshot |

---

### KPIPanel — Financial section

**`src/ui/KPIPanel.js`** updated:
- `#kpi-financial` section (hidden when all financial metrics disabled)
- 4 cards: Session OEE, Avg €/m³, Risk score, Session cost
- Color coding: OEE green ≥85%, amber ≥65%, red <65%; risk green=€0, amber <€50, red ≥€50
- "⚙ Configure" button calls `ConfigModal.openAtSection('config-financial')`

---

### ConfigModal — financial settings section

**`src/ui/ConfigModal.js`** updated:
- `<details id="config-financial">` section rendered via `renderFinancialConfigUI()`
- `openAtSection(sectionId)` helper: opens modal then `scrollIntoView` the target section after 120ms

---

### MultiChartPanel — economic layers

**`src/ui/MultiChartPanel.js`** updated — three independent toggleable economic overlays:

| Button | Layer | Description |
|---|---|---|
| `€ Cost` | Cost accumulation line | Dashed amber overlay per sensor chart; secondary € Y-axis at right edge; disabled when `costPerUnit.enabled=false` |
| `≈ Corr` | Economic correlation | Pearson r between sensor values and `impact2h` in the analytics sidebar; `\|r\| < 0.3` green, `< 0.7` amber, `≥ 0.7` red |
| `⚡ Impact` | Combined impact chart | Separate SVG chart below sensor charts summing `impact2h` across all active sensors; requires ≥2 visible sensors; zone bands at €0 / €10 / €50; synchronized zoom and crosshair |

`⚙ Fin` button in toolbar calls `ConfigModal.openAtSection('config-financial')`.

ChartStore flags (`showEconomicCost`, `showEconomicCorrelation`, `showEconomicImpact`) initialized in `MultiChartPanel.init()` via `ChartStore.setConfig()` since `ChartStore.js` was not modified.

---

## V1.6 — Replay mode — session history scrubber

Users can pause the live data feed and scrub through the last three minutes of telemetry to replay what happened. The whole app (3D scene, telemetry sidebar, alert panel, sensor detail modal) renders from the historical snapshot instead of the live stream while replay is active.

### Architecture

- **`src/core/ReplayController.js`** — single source of truth for replay state. Exposes `enter()`, `exit()`, `scrubTo(index)`, `isActive()`, `getSnapshot()`, and `subscribe(fn)` (observable pattern, same as ChartStore / FinancialConfig). Emits `REPLAY_ENTERED`, `REPLAY_SCRUBBED`, `REPLAY_EXITED` on EventBus. Listens to `DATA_SOURCE_CLEARING` for auto-exit. Snapshot shape: `{ timestamp, readings, index, activeAlertIds }` with `activeAlertIds` derived from `EventMarkers._events` (alert ids seen up to the snapshot timestamp).

- **`src/ui/ReplayBar.js`** — fixed-bottom scrubber (`z-index: 150`). Range input spans full history; SVG overlay draws amber/red flags at the timestamps of alert markers; right side shows absolute timestamp + `Xm Ys ago` delta; `▶ Play` runs at 4× (125ms/frame) and auto-pauses at end; `✕ Back to Live` calls `ReplayController.exit()`. Visibility toggled via `opacity + pointer-events` (not `display: none`) so the entrance transition works. `translateY(100% → 0)` over 0.2s + `opacity 0.15s`. `REPLAY` pill in top-right of viewport mirrors the design token style of the topbar alert chip (`--red-bg`, `border-radius: 4px`, `font-size: 10px`, mono, uppercase, letter-spacing 0.08em).

- **Keyboard shortcuts** (blocked when any input/textarea/select has focus or a modal is open):
  - `R` — toggle replay
  - `← / →` — step ±1 frame (stops playback first)
  - `Space` — play/pause
  - `Escape` — exit

### Module integration

| Module | Behavior |
|---|---|
| `TelemetryPanel.js` | Skips live updates during replay. Listens to `REPLAY_ENTERED/SCRUBBED` → re-renders from snapshot. On `REPLAY_EXITED` repaints from `SensorState.readings`. |
| `SceneUpdater.js` | Skips live `SENSOR_UPDATE` during replay. On `REPLAY_ENTERED/SCRUBBED`: applies ColorMapper with snapshot readings + reapplies emissive glow for every id in `activeAlertIds` (metadata fetched from `EventMarkers`). On `REPLAY_EXITED`: clears all emissive, repaints from live readings. |
| `AlertPanel.js` | `_handleAlert()` is a no-op during replay. Subscribes to `REPLAY_ENTERED/SCRUBBED` and rebuilds the Active section from `snapshot.activeAlertIds` (hydrating each row via `EventMarkers._events`). Counter reads `"N in replay"` in `--red`. On exit, rebuilds Active from `RuleEngine.getActiveAlerts()`. |
| `SensorDetailModal.js` | When replay is active, `_render()` pulls the value from `ReplayController.getSnapshot().readings[id]` instead of `SensorState.get(id)`. A `⏪ Showing historical data` pill replaces the stale-feed banner while in replay. Subscribes to `REPLAY_ENTERED/SCRUBBED/EXITED` to repaint when the modal is open. |
| `Toolbar.js` | New `#btn-replay` button (ghost style) disabled while `SensorState.history.length < 10`. Click → `ReplayController.enter()/exit()`. During replay shows `● Live` in `--red` (`.is-replaying` class). |
| `main.js` | Step 4 initializes `ReplayController` (model) before `ReplayBar` (view). |
| `events.js` | `EVENT_CONTRACT_VERSION` bumped to `'3'`. New events: `REPLAY_ENTERED`, `REPLAY_EXITED`, `REPLAY_SCRUBBED`. |

### Explicit non-changes

Untouched per architectural constraint — these modules remain source-of-truth of their own domain and don't need to know replay exists:

- `src/sensors/SensorState.js`
- `src/sensors/sensor.worker.js`
- `src/core/DataSourceManager.js`
- `src/sensors/RuleEngine.js`
- `src/ui/MultiChartPanel.js`
- `src/sensors/KPIEngine.js`
- `src/ui/KPIPanel.js`

### Edge cases

- `enter()` with empty history → `console.warn` and no-op.
- `scrubTo(index)` outside range → clamp to `[0, history.length - 1]`.
- `DATA_SOURCE_CLEARING` while in replay → auto-exit before history is reset.
- Alert metadata required to repaint during replay is read from `EventMarkers._events`. `EventMarkers` only captures `active: true` transitions, so `activeAlertIds` is a superset of the strictly-active set at that instant — an acceptable simplification since users see all alerts relevant to the surrounding window; rigorous active/resolved cycles remain visible in `AlertPanel`'s History section when live.

---

## V2.0 — Pending

Separate branch `feature/ai-advisor`:
- `ai.worker.js` — TinyLlama via WebLLM (~700MB, opt-in, cached in IndexedDB)
- `AIPanel.js` — natural language diagnosis of process state

Do not merge into `main` until sufficient traction in the repo.

---

## Current events catalog (`src/core/events.js`)

```
EVENT_CONTRACT_VERSION = '3'

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
REPLAY_ENTERED       — replay mode activated (payload: { index, snapshot })
REPLAY_EXITED        — replay mode deactivated (no payload)
REPLAY_SCRUBBED      — cursor moved (payload: { index, snapshot })
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
