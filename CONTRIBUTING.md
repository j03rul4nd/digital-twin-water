# Contributing to WTP Digital Twin

Thank you for your interest in contributing. This guide covers everything you need to know to add sensors, rules, scenarios, or new features without breaking the existing architecture.

---

## Before you start

Read these two files first — they explain every architectural decision and why things are the way they are:

- `PRODUCT.md` — architecture decisions, data flow, contracts between modules
- `DESIGN.md` — UI design principles, color system, component specs

The most important rules in short:

- `EventBus` is for **notifications**, not state. State lives in `SensorState`.
- `ColorMapper` only touches `material.color`. `AlertSystem` only touches `emissiveIntensity`. Never mix them.
- Every module that calls `EventBus.on()` must call `EventBus.off()` in its `destroy()`.
- No `null`, no `undefined`, no `NaN` in sensor readings — ever. The Worker guarantees this.

---

## The easiest contributions

### Add an alert rule

Open `src/sensors/RuleEngine.js` and add an object to the `RULES` array:

```js
{
  id:        'my_rule',          // unique string — used for deduplication
  severity:  'warning',         // 'warning' | 'danger'
  sensorIds: ['inlet_flow'],    // which 3D meshes glow when this fires
  message:   'Human-readable description of what went wrong',
  condition: (readings) => readings.inlet_flow < 30,
}
```

For trend-based rules, use the second argument:

```js
{
  id:        'flow_dropping',
  severity:  'warning',
  sensorIds: ['inlet_flow'],
  message:   'Inlet flow dropping rapidly — check intake pump',
  condition: (readings, state) => {
    const trend = state.getTrend('inlet_flow', 60); // last 60 seconds
    if (!trend || trend.samples < 10) return false;
    return trend.direction === 'falling' && trend.deltaRel < -0.25;
  },
}
```

`getTrend()` returns `{ slope, delta, deltaRel, direction, samples, mean, first, last }`.

That's it. The rule engine handles activation, persistence, resolution, alert history, webhook delivery, and 3D mesh highlighting automatically.

### Add a sensor

**1. Add to `SensorConfig.js`:**

```js
{
  id:       'my_sensor',
  label:    'My Sensor Name',
  unit:     'bar',
  rangeMin: 0,
  rangeMax: 10,
  normal:   { low: 2, high: 8 },
  warning:  { low: 1, high: 9 },
  danger:   { low: 0, high: 10 },
}
```

The dev-mode validator will tell you immediately if any field is missing or invalid.

**2. Bind to a 3D mesh in `SensorSceneMap.js`:**

```js
my_sensor: ['mesh_pump_station'],
```

The mesh name must match exactly what `ModelFactory.js` assigns to `mesh.name`. If you're adding a new mesh, add it to `ModelFactory.js` first, then bind it here.

**3. Simulate it in `sensor.worker.js`:**

Add the sensor to the `lastValid` object and generate its value in `generateSnapshot()`. Follow the causal order — if your sensor correlates with another, calculate it after its driver.

**4. That's it.** The telemetry panel, history charts, color mapping, alert system, KPI engine, and MCP server all pick it up automatically.

### Add an incident scenario

Open `src/sensors/sensor.worker.js` and add a case to `generateSnapshot()`:

```js
if (scenario === 'my_scenario') {
  // Override the values you want to force
  myValue = 999;
}
```

Then add the button in `src/ui/IncidentPanel.js`:

```js
const SCENARIOS = [
  // ... existing scenarios
  {
    name:     'my_scenario',
    label:    'My Scenario',
    icon:     '⚠',
    severity: 'warning',
    desc:     'What this scenario simulates',
  },
];
```

---

## Bigger contributions

### Add a new UI panel

1. Create `src/ui/MyPanel.js` following the pattern of `SensorDetailModal.js` or `KPIPanel.js`
2. Implement `init()`, `open()`, `close()`, `destroy()`
3. Add `destroy()` that calls `EventBus.off()` for every `EventBus.on()` in `init()`
4. Initialize in `main.js` at step 4 — before `SensorWorker.start()`
5. Add the trigger button to `index.html`
6. Add CSS to `index.html` using the design tokens from `DESIGN.md`

Design rules that are non-negotiable:
- `font-mono` for numeric values, `font-sans` for labels — no exceptions
- `--green`/`--amber`/`--red` only for process state, `--blue` only for user actions
- No `display: none` on elements that need to transition — use `opacity: 0/1`

### Add a new event

1. Add to `src/core/events.js` with its payload documented in a comment
2. Bump `EVENT_CONTRACT_VERSION` if you change an existing payload shape
3. Never use string literals for event names — always import from `events.js`

### Add a new MCP tool

Open `mcp-server.js` and add an entry to the `TOOLS` object:

```js
my_tool: {
  description: 'What this tool does — Claude reads this to decide when to use it.',
  inputSchema: {
    type: 'object',
    properties: {
      my_param: { type: 'string', description: 'What this param does' },
    },
    required: ['my_param'],
  },
  handler({ my_param } = {}) {
    const state = readState();
    // ... read from state and return a string
    return `Result: ${state.readings[my_param]}`;
  },
},
```

---

## Adding support for a new MQTT format

The `PayloadMapper.js` auto-detect handles most cases. If you need a new format:

1. Add a new mode constant
2. Implement the extraction logic in a `_extractMyFormat()` method
3. Add it to the `switch` in `transform()`
4. Add the mode option to `PayloadMapperPanel.js`

---

## Code style

- **ES Modules** throughout — no CommonJS `require()`
- **Plain classes** as object literals — no `class` syntax, no `extends`
- **No framework** — no React, no Vue, no Angular
- Indent with 2 spaces
- Single quotes for strings
- Trailing commas in multiline arrays/objects

---

## Pull request checklist

- [ ] Tested in Chrome and Firefox
- [ ] No `console.log` left in production paths (use `import.meta.env.DEV` guards)
- [ ] New EventBus listeners have corresponding `EventBus.off()` in `destroy()`
- [ ] New sensors have entries in both `SensorConfig.js` and `SensorSceneMap.js`
- [ ] New rules have unique `id` strings
- [ ] No hardcoded colors outside the CSS token system
- [ ] `font-mono` used for numeric values, `font-sans` for labels
- [ ] PROGRESS.md updated if you added a significant feature

---

## Questions

Open an issue or reach out via [LinkedIn](https://www.linkedin.com/in/joel-benitez-iiot-industry/).