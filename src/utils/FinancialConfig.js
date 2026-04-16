/**
 * FinancialConfig.js — Single source of truth for financial analytics config.
 *
 * Persists to localStorage (key: wtp_financial_config).
 * Notifies subscribers synchronously when config changes.
 * Consumed by SensorDetailModal, KPIEngine, KPIPanel, MultiChartPanel.
 */

const STORAGE_KEY = 'wtp_financial_config';

const DEFAULTS = {
  oee:            { enabled: true },
  costPerUnit:    { enabled: true, energyCostPerHour: 0.15, pumpPowerKW: 5, chemicalCostPerM3: 0.02 },
  degradation:    { enabled: true, minSamples: 20 },
  volatility:     { enabled: true, windowSize: 120 },
  sharpe:         { enabled: true, baseline: 0 },
  economicImpact: { enabled: true, costPerDeviationUnit: 0.5, costPerHourDowntime: 50 },
};

const FinancialConfig = {
  _config:    null,
  _listeners: [],

  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Deep merge: keep defaults for any missing metric or param
        this._config = {};
        for (const key of Object.keys(DEFAULTS)) {
          this._config[key] = { ...DEFAULTS[key], ...(parsed[key] ?? {}) };
        }
      } else {
        this._config = JSON.parse(JSON.stringify(DEFAULTS));
      }
    } catch {
      this._config = JSON.parse(JSON.stringify(DEFAULTS));
    }
    return this;
  },

  get() {
    if (!this._config) this.load();
    return this._config;
  },

  set(metricKey, paramKey, value) {
    if (!this._config) this.load();
    if (!this._config[metricKey]) return;
    this._config[metricKey][paramKey] = value;
    this._persist();
    this._notify();
  },

  setEnabled(metricKey, enabled) {
    this.set(metricKey, 'enabled', enabled);
  },

  reset() {
    this._config = JSON.parse(JSON.stringify(DEFAULTS));
    this._persist();
    this._notify();
  },

  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  },

  _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._config)); } catch {}
  },

  _notify() {
    this._listeners.forEach(fn => { try { fn(this._config); } catch {} });
  },
};

export default FinancialConfig;
