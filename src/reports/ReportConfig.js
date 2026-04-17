/**
 * ReportConfig.js — Single source of truth for report generation config.
 *
 * Persists to localStorage (key: wtp_report_config).
 * Logo persists separately (key: wtp_report_logo) due to size.
 * Notifies subscribers synchronously when config changes.
 */

const STORAGE_KEY      = 'wtp_report_config';
const LOGO_STORAGE_KEY = 'wtp_report_logo';

export const DEFAULTS = {
  branding: {
    companyName:   'Water Operations Co.',
    companyLogo:   null,
    primaryColor:  '#1a4a7a',
    accentColor:   '#0ea5e9',
    footerText:    'Confidential — Internal Use Only',
    reportAuthor:  '',
    plantName:     'Plant #1',
    plantId:       'plant-01',
    plantLocation: '',
  },
  sections: {
    includeKPIs:                true,
    includeActiveAlerts:        true,
    includeResolvedAlerts:      true,
    includeSensorCharts:        true,
    includeStatisticalAnalysis: false,
    includeCostAnalysis:        true,
    includeSignatureLine:       false,
    maxSensorsToChart:          3,
    chartTimeWindowSeconds:     180,
  },
  template:    'EXECUTIVE_SUMMARY',
  pageFormat:  'a4',
  orientation: 'portrait',
};

const ReportConfig = {
  _config:    null,
  _listeners: [],

  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this._config = {
          branding:    { ...DEFAULTS.branding,  ...(parsed.branding  ?? {}) },
          sections:    { ...DEFAULTS.sections,  ...(parsed.sections  ?? {}) },
          template:    parsed.template    ?? DEFAULTS.template,
          pageFormat:  parsed.pageFormat  ?? DEFAULTS.pageFormat,
          orientation: parsed.orientation ?? DEFAULTS.orientation,
        };
      } else {
        this._config = JSON.parse(JSON.stringify(DEFAULTS));
      }
      // Load logo separately (may be large)
      this._config.branding.companyLogo = localStorage.getItem(LOGO_STORAGE_KEY) || null;
    } catch {
      this._config = JSON.parse(JSON.stringify(DEFAULTS));
    }
    return this;
  },

  get() {
    if (!this._config) this.load();
    return this._config;
  },

  set(sectionKey, paramKey, value) {
    if (!this._config) this.load();
    if (sectionKey === 'template' || sectionKey === 'pageFormat' || sectionKey === 'orientation') {
      this._config[sectionKey] = value;
    } else {
      if (!this._config[sectionKey]) return;
      this._config[sectionKey][paramKey] = value;
    }
    this._persist();
    this._notify();
  },

  setLogo(base64String) {
    if (!this._config) this.load();
    try {
      localStorage.setItem(LOGO_STORAGE_KEY, base64String);
      this._config.branding.companyLogo = base64String;
      this._notify();
    } catch (e) {
      throw new Error('Logo storage failed — file may be too large for localStorage quota.');
    }
  },

  clearLogo() {
    if (!this._config) this.load();
    localStorage.removeItem(LOGO_STORAGE_KEY);
    this._config.branding.companyLogo = null;
    this._notify();
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
    try {
      const toSave = { ...this._config };
      // Don't persist logo in main config (separate key)
      toSave.branding = { ...this._config.branding, companyLogo: null };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {}
  },

  _notify() {
    this._listeners.forEach(fn => { try { fn(this._config); } catch {} });
  },
};

export default ReportConfig;
