/**
 * ReportEngine.js — Orchestrates PDF report generation.
 *
 * Public API:
 *   generateReport(options)     → Promise<Blob>   — full PDF
 *   getReportDataSnapshot()     → object          — plain JSON snapshot (for MCP)
 *   registerSection(id, fn)     — extend with custom sections
 *
 * Each call to generateReport() takes an immutable data snapshot at t=0,
 * so values cannot change mid-render.
 */

import { jsPDF } from 'jspdf';
import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import SensorState from '../sensors/SensorState.js';
import RuleEngine  from '../sensors/RuleEngine.js';
import KPIEngine   from '../sensors/KPIEngine.js';
import ReportConfig from './ReportConfig.js';
import { SENSORS } from '../sensors/SensorConfig.js';
import FinancialConfig from '../utils/FinancialConfig.js';
import { captureSvgToPng, buildFallbackChartPng } from './ReportChartCapture.js';
import {
  renderHeader,
  renderFooter,
  renderKPIRow,
  renderSensorTable,
  renderActiveAlertsTable,
  renderResolvedAlertsTable,
  renderOperatorStrip,
  renderSignatureLine,
  renderIncidentSummaryBar,
  renderRootCauseSection,
  renderAlertTimeline,
  renderChartGrid,
  renderExecutiveKPIRow,
  renderTopAlertsTable,
  renderFinancialCard,
  renderLargeChart,
} from './ReportSections.js';

// ── Custom section registry ───────────────────────────────────────────────────

const _customSections = new Map();

// ── State ─────────────────────────────────────────────────────────────────────

let _isGenerating = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _yield() {
  return new Promise(r => setTimeout(r, 0));
}

function _progress(pct, label, onProgress) {
  onProgress?.(pct, label);
  EventBus.emit(EVENTS.REPORT_GENERATION_PROGRESS, { pct, label });
}

/**
 * Collects chart images for the sensors requested.
 * Tries live DOM SVGs first, falls back to buildFallbackChartPng.
 *
 * @param {string[]} sensorIds
 * @param {object[]} sensors     — full SENSORS config
 * @param {object}   history     — SensorState.history slice
 * @returns {Promise<Array<{label, unit, dataUrl}>>}
 */
async function _captureCharts(sensorIds, sensors, history) {
  const results = [];

  for (const sensorId of sensorIds) {
    const cfg = sensors.find(s => s.id === sensorId);
    if (!cfg) continue;

    // Try live DOM SVGs from MultiChartPanel (.mc-chart is itself the <svg>)
    // or SensorDetailModal (#sd-chart). Fall through immediately if panel is closed.
    let dataUrl = null;
    const svgEl =
      document.querySelector(`.mc-chart[data-sensor-id="${sensorId}"]`) ||
      document.querySelector(`#sd-chart`);   // modal — only present when open for this sensor

    if (svgEl) {
      dataUrl = await captureSvgToPng(svgEl, { width: 600, height: 200 });
    }

    // Always build from history data when DOM capture failed or returned blank.
    // This is the primary path during report generation (panels are usually closed).
    if (!dataUrl) {
      const points = history
        .map(snap => ({ timestamp: snap.timestamp, value: snap.readings?.[sensorId] }))
        .filter(p => typeof p.value === 'number' && isFinite(p.value));

      dataUrl = await buildFallbackChartPng(points, {
        label:      cfg.label,
        unit:       cfg.unit,
        normal:     cfg.normal,
        warning:    cfg.warning,
        danger:     cfg.danger,
        rangeMin:   cfg.rangeMin,
        rangeMax:   cfg.rangeMax,
      }, { width: 600, height: 200 });
    }

    results.push({ label: cfg.label, unit: cfg.unit, dataUrl });
  }

  return results;
}

// ── Template renderers ────────────────────────────────────────────────────────

async function _renderShiftHandover(doc, data, config, onProgress) {
  _progress(42, 'Building shift handover layout…', onProgress);
  await _yield();

  let y = renderHeader(doc, data, config, 32);
  y = renderOperatorStrip(doc, data, config, y);

  if (config.sections.includeKPIs) {
    y = renderKPIRow(doc, data, config, y, 22);
  }

  await _yield();
  _progress(55, 'Rendering sensor table…', onProgress);

  y = renderSensorTable(doc, data, config, y);

  if (config.sections.includeResolvedAlerts) {
    y = renderResolvedAlertsTable(doc, data, config, y);
  }

  if (config.sections.includeActiveAlerts) {
    y = renderActiveAlertsTable(doc, data, config, y);
  }

  if (config.sections.includeSignatureLine) {
    y = renderSignatureLine(doc, data, config, y);
  }
}

async function _renderIncidentReport(doc, data, config, chartImages, onProgress) {
  _progress(42, 'Building incident report…', onProgress);
  await _yield();

  let y = renderHeader(doc, data, config, 32);
  y = renderIncidentSummaryBar(doc, data, config, y);
  y = renderRootCauseSection(doc, data, config, y);

  if (config.sections.includeSensorCharts && chartImages.length > 0) {
    _progress(55, 'Embedding sensor charts…', onProgress);
    await _yield();
    y = await renderChartGrid(doc, data, config, y, chartImages);
  }

  // Alert timeline on a new page if needed
  y = renderAlertTimeline(doc, data, config, y);

  if (config.sections.includeActiveAlerts) {
    y = renderActiveAlertsTable(doc, data, config, y);
  }

  if (config.sections.includeResolvedAlerts) {
    y = renderResolvedAlertsTable(doc, data, config, y);
  }

  if (config.sections.includeCostAnalysis) {
    y = renderFinancialCard(doc, data, config, y);
  }
}

async function _renderExecutiveSummary(doc, data, config, chartImages, onProgress) {
  _progress(42, 'Building executive summary…', onProgress);
  await _yield();

  let y = renderHeader(doc, data, config, 32);

  if (config.sections.includeKPIs) {
    y = renderExecutiveKPIRow(doc, data, config, y);
  }

  if (config.sections.includeSensorCharts && chartImages.length > 0) {
    _progress(55, 'Embedding sensor trends…', onProgress);
    await _yield();
    y = await renderChartGrid(doc, data, config, y, chartImages);
  }

  y = renderTopAlertsTable(doc, data, config, y);

  if (config.sections.includeCostAnalysis) {
    y = renderFinancialCard(doc, data, config, y);
  }

  // Expanded charts on additional pages
  if (config.sections.includeSensorCharts && chartImages.length > 3) {
    _progress(68, 'Adding expanded chart pages…', onProgress);
    await _yield();
    for (const img of chartImages.slice(3)) {
      doc.addPage();
      renderHeader(doc, data, config, 32);
      await renderLargeChart(doc, data, config, 38, img);
    }
  }
}

// ── Footer pass (all pages) ───────────────────────────────────────────────────

function _applyFooters(doc, config) {
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    renderFooter(doc, config, i, total);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const ReportEngine = {

  /**
   * Registers a custom section renderer.
   * fn(doc, data, config, y) → Promise<number> (new cursor Y)
   */
  registerSection(id, fn) {
    _customSections.set(id, fn);
  },

  /**
   * Returns a plain-JSON snapshot of all current plant data.
   * Used both by generateReport() and the future MCP tool.
   *
   * @param {{ rootCause?: string }} [opts]
   */
  getReportDataSnapshot(opts = {}) {
    const cfg      = ReportConfig.get();
    const readings = { ...SensorState.readings };
    const history  = SensorState.history.slice(-360);
    const kpis     = KPIEngine.getLastKPIs() ?? {};

    // Lazy import to avoid circular dep — AlertPanel is optional
    let resolvedAlerts = [];
    let activeAlerts   = RuleEngine.getActiveAlerts();
    try {
      // AlertPanel is initialized in main.js step 4; may not exist in MCP/headless mode
      const mod = ReportEngine._alertPanel;
      if (mod?.getResolvedAlerts) resolvedAlerts = mod.getResolvedAlerts();
    } catch {}

    const template = cfg.template;
    const titles = {
      SHIFT_HANDOVER:    'Shift Handover Report',
      INCIDENT_REPORT:   'Incident Report',
      EXECUTIVE_SUMMARY: 'Executive Summary',
    };

    return {
      generatedAt:    Date.now(),
      reportTitle:    titles[template] ?? 'Plant Status Report',
      plant: {
        id:       cfg.branding.plantId,
        name:     cfg.branding.plantName,
        location: cfg.branding.plantLocation,
      },
      sensors:        SENSORS,
      readings,
      history,
      activeAlerts,
      resolvedAlerts,
      kpis,
      financialConfig: FinancialConfig.get(),
      rootCause:       opts.rootCause ?? '',
    };
  },

  /**
   * Generates a PDF and returns it as a Blob.
   *
   * @param {{
   *   template?:   string,
   *   sections?:   object,
   *   rootCause?:  string,
   *   onProgress?: (pct: number, label: string) => void,
   *   onError?:    (err: Error) => void,
   *   onlyData?:   boolean,
   * }} options
   * @returns {Promise<Blob>}
   */
  async generateReport(options = {}) {
    if (_isGenerating) {
      throw new Error('A report is already being generated. Please wait.');
    }

    if (!SensorState.isReady()) {
      throw new Error('No sensor data available. Start simulation or connect MQTT first.');
    }

    _isGenerating = true;
    const t0 = Date.now();

    const { onProgress, onError, rootCause = '', onlyData = false } = options;

    const config = ReportConfig.get();
    if (options.template) config.template = options.template;
    if (options.sections) {
      config.sections = { ...config.sections, ...options.sections };
    }

    const template = config.template;

    EventBus.emit(EVENTS.REPORT_GENERATION_STARTED, { template, timestamp: t0 });
    _progress(0, 'Collecting plant data…', onProgress);

    try {
      // Immutable snapshot — data will not change during render
      const data = this.getReportDataSnapshot({ rootCause });

      // MCP/headless mode: return only the data snapshot
      if (onlyData) {
        _isGenerating = false;
        return data;
      }

      await _yield();
      _progress(10, 'Capturing sensor charts…', onProgress);

      // ── Chart capture ───────────────────────────────────────────────────────
      let chartImages = [];
      if (config.sections.includeSensorCharts) {
        const maxCharts = Math.max(1, config.sections.maxSensorsToChart || 3);
        const sensorIds = SENSORS.slice(0, maxCharts).map(s => s.id);
        chartImages = await _captureCharts(sensorIds, SENSORS, data.history);
        _progress(38, `Captured ${chartImages.length} charts…`, onProgress);
        await _yield();
      }

      // ── jsPDF document ──────────────────────────────────────────────────────
      _progress(40, 'Initializing document…', onProgress);
      const doc = new jsPDF({
        orientation: config.orientation ?? 'portrait',
        unit:        'mm',
        format:      config.pageFormat ?? 'a4',
      });

      // ── Template rendering ──────────────────────────────────────────────────
      switch (template) {
        case 'SHIFT_HANDOVER':
          await _renderShiftHandover(doc, data, config, onProgress);
          break;
        case 'INCIDENT_REPORT':
          await _renderIncidentReport(doc, data, config, chartImages, onProgress);
          break;
        case 'EXECUTIVE_SUMMARY':
        default:
          await _renderExecutiveSummary(doc, data, config, chartImages, onProgress);
          break;
      }

      // ── Custom sections ─────────────────────────────────────────────────────
      for (const [, fn] of _customSections) {
        try { await fn(doc, data, config, 36); } catch {}
      }

      // ── Footer on every page ────────────────────────────────────────────────
      _progress(88, 'Finalizing PDF…', onProgress);
      await _yield();
      _applyFooters(doc, config);

      // ── Output ──────────────────────────────────────────────────────────────
      _progress(96, 'Encoding output…', onProgress);
      const blob = doc.output('blob');

      const duration   = Date.now() - t0;
      const sizeBytes  = blob.size;

      EventBus.emit(EVENTS.REPORT_GENERATION_COMPLETE, { template, sizeBytes, duration });
      _progress(100, 'Ready!', onProgress);

      return blob;

    } catch (err) {
      const msg = err?.message ?? String(err);
      EventBus.emit(EVENTS.REPORT_GENERATION_ERROR, { error: msg, template });
      onError?.(err);
      throw err;
    } finally {
      _isGenerating = false;
    }
  },

  /**
   * Triggers a quick download of the generated PDF.
   * @param {Blob} blob
   * @param {string} [template]
   */
  downloadBlob(blob, template = 'report') {
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `wtp-report-${template.toLowerCase()}-${ts}.pdf`;
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  },

  /**
   * Set AlertPanel reference so getReportDataSnapshot can pull resolved alerts.
   * Called from main.js after AlertPanel.init().
   */
  _alertPanel: null,
};

export default ReportEngine;
