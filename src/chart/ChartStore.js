/**
 * ChartStore.js — Reactive state store for chart visualization.
 *
 * Manages chart UI state independently from SensorState (which holds raw data).
 * Lightweight pub/sub — zero external dependencies.
 *
 * Responsibilities:
 *   - Which sensors are active in the multi-chart panel
 *   - Shared crosshair position (hoverFraction: 0..1 of visible window)
 *   - Time window (viewWindow: { startFrac, endFrac } or null = full range)
 *   - Visual settings (chartType, scaleType, overlays)
 *   - Comparison baseline snapshot
 *
 * Usage:
 *   ChartStore.subscribe('hoverFraction', (val) => updateCrosshair(val));
 *   ChartStore.set('hoverFraction', 0.42);
 *   const unsub = ChartStore.subscribe('activeSensors', handler);
 *   unsub(); // remove listener
 */

const ChartStore = {

  // ─── State ─────────────────────────────────────────────────────────────────
  _state: {
    /** string[] — sensor IDs currently shown in the panel */
    activeSensors:   [],

    /** number | null — shared crosshair position as fraction of visible window */
    hoverFraction:   null,

    /** { startFrac: number, endFrac: number } | null — null = full history */
    viewWindow:      null,

    /** 'line' | 'scatter' */
    chartType:       'line',

    /** 'linear' | 'log' */
    scaleType:       'linear',

    /** Show background zone bands */
    showBands:       true,

    /** Show warning/danger threshold reference lines */
    showRefLines:    true,

    /** Overlay anomaly markers detected by AnalyticsEngine */
    showAnomalies:   true,

    /** Overlay moving average smoothing line */
    showMA:          false,

    /** Moving average window (samples) */
    maWindow:        10,

    /** Frozen baseline snapshot for historical comparison { sensorId: readings[] } */
    baseline:        null,

    /** Active tab in the analytics sidebar */
    activeTab:       'analytics',   // 'analytics' | 'export'
  },

  // ─── Subscriptions ─────────────────────────────────────────────────────────
  _subs: {},  // key → Set<fn>

  // ─── Public API ────────────────────────────────────────────────────────────

  get(key) {
    return this._state[key];
  },

  /**
   * Update a state key and notify all subscribers.
   * No-op if value is strictly equal (avoids unnecessary re-renders).
   */
  set(key, value) {
    const prev = this._state[key];
    if (prev === value) return;
    this._state[key] = value;
    this._notify(key, value, prev);
  },

  getState() {
    return { ...this._state };
  },

  /**
   * Subscribe to changes of a specific key.
   * Use '*' to subscribe to all changes (receives key, value, prev).
   * @returns {Function} unsubscribe — call to remove listener
   */
  subscribe(key, fn) {
    if (!this._subs[key]) this._subs[key] = new Set();
    this._subs[key].add(fn);
    return () => this._subs[key]?.delete(fn);
  },

  /** Toggle sensor in/out of activeSensors list (max 4 to keep UI manageable) */
  toggleSensor(sensorId) {
    const current = [...this._state.activeSensors];
    const idx     = current.indexOf(sensorId);
    let   next;

    if (idx >= 0) {
      next = current.filter(id => id !== sensorId);
    } else {
      if (current.length >= 4) current.shift(); // drop oldest when at limit
      next = [...current, sensorId];
    }

    this.set('activeSensors', next);
  },

  /** Capture the current SensorState history as a baseline for comparison */
  captureBaseline(sensorHistories) {
    this.set('baseline', { ...sensorHistories, capturedAt: Date.now() });
  },

  clearBaseline() {
    this.set('baseline', null);
  },

  /** Reset all state to defaults */
  reset() {
    Object.assign(this._state, {
      activeSensors: [],
      hoverFraction: null,
      viewWindow:    null,
      chartType:     'line',
      scaleType:     'linear',
      showBands:     true,
      showRefLines:  true,
      showAnomalies: true,
      showMA:        false,
      maWindow:      10,
      baseline:      null,
      activeTab:     'analytics',
    });
    // Notify all keys that might have changed
    ['activeSensors', 'hoverFraction', 'viewWindow', 'chartType', 'scaleType',
     'showBands', 'showRefLines', 'showAnomalies', 'showMA', 'baseline'].forEach(k => {
      this._subs[k]?.forEach(fn => fn(this._state[k], undefined));
    });
  },

  // ─── Internal ──────────────────────────────────────────────────────────────

  _notify(key, value, prev) {
    this._subs[key]?.forEach(fn => fn(value, prev));
    this._subs['*']?.forEach(fn => fn(key, value, prev));
  },
};

export default ChartStore;
