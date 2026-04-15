/**
 * ChartStore.js — Observable store for the multi-chart panel state.
 *
 * Responsabilidades:
 *   - Qué sensores están activos y cuáles visibles (toggle por el usuario)
 *   - Ventana de zoom compartida: { startFrac, endFrac } ∈ [0,1]
 *   - Fracción de cursor compartida: hoverFrac ∈ [0,1] | null
 *   - Configuración de visualización: tipo de gráfico, escala, overlays
 *
 * Patrón: pub-sub manual sin dependencias externas.
 * Cada suscripción devuelve un "unsubscribe" function (return value de subscribe).
 *
 * No emite sobre EventBus — su scope es interno al panel de gráficas.
 * EventBus se usa para comunicación entre módulos de alto nivel.
 *
 * Uso:
 *   import ChartStore from './ChartStore.js';
 *   const off = ChartStore.subscribe('zoom', zoom => ...);
 *   ChartStore.setZoom(0.1, 0.9);
 *   off(); // limpia la suscripción
 */

// ─── Palette de colores para identificación de series (modo overlay futuro) ───
export const SERIES_PALETTE = [
  '#60a5fa', // blue-400
  '#f472b6', // pink-400
  '#a78bfa', // violet-400
  '#34d399', // emerald-400
  '#fb923c', // orange-400
  '#38bdf8', // sky-400
  '#facc15', // yellow-400
  '#4ade80', // green-400
];

// ─── Estado inicial ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  chartType:       'line',    // 'line' | 'scatter'
  scaleType:       'linear',  // 'linear' (log scale: future)
  showDerivative:  false,     // overlay de derivada
  showAnomalies:   false,     // marcar puntos anómalos
  showStats:       true,      // barra de stats debajo de cada gráfico
  showCorrelation: true,      // tabla de correlaciones en sidebar
  timeWindow:      180,       // segundos visibles en zoom total (3 minutos)
  maxSeries:       6,         // número máximo de sensores simultáneos
};

// ─── Store ────────────────────────────────────────────────────────────────────

const ChartStore = {
  /**
   * Active series list.
   * @type {{ sensorId: string, visible: boolean, color: string }[]}
   */
  activeSeries: [],

  /**
   * Zoom window as fractions of total history length (0 = oldest, 1 = newest).
   * startFrac < endFrac; endFrac=1 means "latest data visible".
   * @type {{ startFrac: number, endFrac: number }}
   */
  zoomWindow: { startFrac: 0, endFrac: 1 },

  /**
   * Shared crosshair position — fraction within the CURRENT zoom window.
   * null = no active hover.
   * @type {number | null}
   */
  hoverFrac: null,

  /**
   * Visualization configuration.
   */
  config: { ...DEFAULT_CONFIG },

  /** @private */
  _listeners: new Map(),

  // ─── Subscribe ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to a store key change.
   * @param {'series'|'zoom'|'hover'|'config'} key
   * @param {Function} fn — called with the new value
   * @returns {Function} — unsubscribe
   */
  subscribe(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(fn);
    return () => this._listeners.get(key)?.delete(fn);
  },

  /** @private */
  _emit(key, value) {
    this._listeners.get(key)?.forEach(fn => {
      try { fn(value); } catch (e) { console.error('[ChartStore] listener error:', e); }
    });
  },

  // ─── Series management ───────────────────────────────────────────────────────

  /**
   * Add a sensor to active series. No-op if already present or at max capacity.
   * @param {string} sensorId
   * @returns {boolean} — whether sensor was added
   */
  addSeries(sensorId) {
    if (this.activeSeries.some(s => s.sensorId === sensorId)) return false;
    if (this.activeSeries.length >= this.config.maxSeries) return false;

    const color = SERIES_PALETTE[this.activeSeries.length % SERIES_PALETTE.length];
    this.activeSeries = [...this.activeSeries, { sensorId, visible: true, color }];
    this._emit('series', this.activeSeries);
    return true;
  },

  /**
   * Remove a sensor from active series.
   * @param {string} sensorId
   */
  removeSeries(sensorId) {
    this.activeSeries = this.activeSeries.filter(s => s.sensorId !== sensorId);
    this._emit('series', this.activeSeries);
  },

  /**
   * Toggle visibility of a series (show/hide without removing).
   * @param {string} sensorId
   */
  toggleSeries(sensorId) {
    this.activeSeries = this.activeSeries.map(s =>
      s.sensorId === sensorId ? { ...s, visible: !s.visible } : s,
    );
    this._emit('series', this.activeSeries);
  },

  hasSeries(sensorId) {
    return this.activeSeries.some(s => s.sensorId === sensorId);
  },

  getVisibleSeries() {
    return this.activeSeries.filter(s => s.visible);
  },

  // ─── Zoom ────────────────────────────────────────────────────────────────────

  /**
   * Set the zoom window.
   * Both values are clamped to [0, 1]; startFrac is forced < endFrac.
   * Minimum window size is 5% of total history (prevents degeneracy).
   */
  setZoom(startFrac, endFrac) {
    const s = Math.max(0, Math.min(1, startFrac));
    const e = Math.max(0, Math.min(1, endFrac));
    const MIN_RANGE = 0.05;

    if (e - s < MIN_RANGE) {
      // Keep the window centered on the requested range
      const center = (s + e) / 2;
      this.zoomWindow = {
        startFrac: Math.max(0, center - MIN_RANGE / 2),
        endFrac:   Math.min(1, center + MIN_RANGE / 2),
      };
    } else {
      this.zoomWindow = { startFrac: s, endFrac: e };
    }

    this._emit('zoom', this.zoomWindow);
  },

  resetZoom() {
    this.zoomWindow = { startFrac: 0, endFrac: 1 };
    this._emit('zoom', this.zoomWindow);
  },

  /**
   * Zoom in/out centered on a given absolute fraction of the data.
   * @param {number} centerFrac  — absolute fraction to zoom around (0-1)
   * @param {number} factor      — >1 zooms out, <1 zooms in
   */
  zoomAround(centerFrac, factor) {
    const { startFrac, endFrac } = this.zoomWindow;
    const range    = endFrac - startFrac;
    const newRange = Math.max(0.05, Math.min(1, range * factor));
    const newStart = centerFrac - newRange * ((centerFrac - startFrac) / range);
    this.setZoom(newStart, newStart + newRange);
  },

  /**
   * Pan the zoom window by a delta in fraction units.
   * Clamps so the window doesn't go out of [0, 1].
   * @param {number} deltaFrac — positive = shift toward older data
   */
  panBy(deltaFrac) {
    const { startFrac, endFrac } = this.zoomWindow;
    const range = endFrac - startFrac;
    const newStart = Math.max(0, Math.min(1 - range, startFrac + deltaFrac));
    this.zoomWindow = { startFrac: newStart, endFrac: newStart + range };
    this._emit('zoom', this.zoomWindow);
  },

  // ─── Hover / crosshair sync ───────────────────────────────────────────────────

  /**
   * Update shared crosshair position.
   * @param {number|null} frac — fraction within visible zoom window, or null to hide
   */
  setHoverFrac(frac) {
    this.hoverFrac = frac;
    this._emit('hover', frac);
  },

  clearHover() {
    this.hoverFrac = null;
    this._emit('hover', null);
  },

  // ─── Config ──────────────────────────────────────────────────────────────────

  /**
   * Update a single config key.
   * @param {keyof typeof DEFAULT_CONFIG} key
   * @param {*} value
   */
  setConfig(key, value) {
    this.config = { ...this.config, [key]: value };
    this._emit('config', this.config);
  },

  /**
   * Toggle a boolean config key.
   * @param {keyof typeof DEFAULT_CONFIG} key
   */
  toggleConfig(key) {
    if (typeof this.config[key] === 'boolean') {
      this.setConfig(key, !this.config[key]);
    }
  },

  // ─── Reset ────────────────────────────────────────────────────────────────────

  /**
   * Full reset — called when the panel is closed.
   * Preserves config (user preferences survive panel close/reopen).
   */
  reset() {
    this.activeSeries = [];
    this.zoomWindow   = { startFrac: 0, endFrac: 1 };
    this.hoverFrac    = null;
    // config intentionally NOT reset — user prefs persist
  },

  /**
   * Clear all subscribers (e.g., when panel is destroyed).
   */
  clearListeners() {
    this._listeners.clear();
  },
};

export default ChartStore;
