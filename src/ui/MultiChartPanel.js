/**
 * MultiChartPanel.js — Panel de análisis multi-sensor.
 *
 * Arquitectura:
 *   Data layer  : SensorState.getHistory() + AnalyticsEngine (stateless)
 *   State layer : ChartStore (zoom, hover, series, config)
 *   Render layer: SVG puro — misma técnica que SensorDetailModal pero
 *                 compartiendo cursor y ventana de zoom entre todos los gráficos
 *
 * Características:
 *   ✓ Hasta 6 sensores en paralelo (stacked vertically)
 *   ✓ Cursor sincronizado — hover sobre cualquier gráfico mueve todos
 *   ✓ Zoom/pan con rueda del ratón + drag (compartido entre gráficos)
 *   ✓ Segmentos multicolor: verde/ámbar/rojo por zona de estado
 *   ✓ Overlay de derivada (tasa de cambio) por gráfico
 *   ✓ Detección y marcado de anomalías (Z-score)
 *   ✓ Sidebar analítico: stats + tendencia + correlaciones
 *   ✓ Exportación CSV + JSON config
 *   ✓ Stale feed detection (mismo mecanismo que SensorDetailModal)
 *
 * Wiring:
 *   - Inicializado en main.js paso 4 (antes de StartupModal)
 *   - Abierto via EventBus.emit(EVENTS.OPEN_MULTI_CHART, { sensorIds? })
 *   - También accesible desde SensorDetailModal ("Compare" button)
 */

import EventBus             from '../core/EventBus.js';
import { EVENTS }           from '../core/events.js';
import SensorState          from '../sensors/SensorState.js';
import { SENSORS }          from '../sensors/SensorConfig.js';
import { getSensorState }   from '../scene/ColorMapper.js';
import ChartStore           from '../charts/ChartStore.js';
import {
  computeStats,
  computeDerivative,
  detectAnomalies,
  computeCorrelation,
  computeCorrelationMatrix,
  describeCorrelation,
  lttbDownsample,
  computeTrend,
  formatTrend,
  compareWindows,
} from '../charts/AnalyticsEngine.js';
import EventMarkers    from '../charts/EventMarkers.js';
import FinancialConfig from '../utils/FinancialConfig.js';
import { computeEconomicImpact, computeCostPerUnit } from '../utils/FinancialAnalytics.js';
import ConfigModal from './ConfigModal.js';

// ─── SVG geometry ─────────────────────────────────────────────────────────────
const CW   = 600;   // SVG viewBox width
const CH   = 110;   // SVG viewBox height per chart
const PAD  = { top: 10, right: 10, bottom: 22, left: 44 };
const ICW  = CW - PAD.left - PAD.right;   // inner chart width
const ICH  = CH - PAD.top  - PAD.bottom;  // inner chart height

const STALE_MS = 2500;

// ─── Color constants ──────────────────────────────────────────────────────────
const COL = {
  normal:  { line: '#22c55e', area: 'rgba(34,197,94,0.09)',   band: 'rgba(34,197,94,0.05)'   },
  warning: { line: '#f59e0b', area: 'rgba(245,158,11,0.09)',  band: 'rgba(245,158,11,0.06)'  },
  danger:  { line: '#ef4444', area: 'rgba(239,68,68,0.09)',   band: 'rgba(239,68,68,0.07)'   },
  deriv:   { line: '#818cf8' },   // indigo for derivative overlay
  anomaly: '#f87171',              // red-400 for anomaly dots
};

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// ─── MultiChartPanel ─────────────────────────────────────────────────────────

const MultiChartPanel = {
  _overlay:        null,
  _updateTimer:    null,
  _unsubscribers:  [],
  _dragState:      null,   // { startX, startZoom } for pan drag
  _eventHandlers:  [],

  // ─── Public API ─────────────────────────────────────────────────────────────

  init() {
    this._build();
    this._injectStyles();
    FinancialConfig.load();

    // Initialize economic overlay flags (don't overwrite if already set)
    if (ChartStore.config.showEconomicCost       === undefined) ChartStore.setConfig('showEconomicCost', false);
    if (ChartStore.config.showEconomicCorrelation === undefined) ChartStore.setConfig('showEconomicCorrelation', false);
    if (ChartStore.config.showEconomicImpact      === undefined) ChartStore.setConfig('showEconomicImpact', false);

    // Open from any emitter
    const onOpen = ({ sensorIds } = {}) => this.open(sensorIds);
    EventBus.on(EVENTS.OPEN_MULTI_CHART, onOpen);
    this._eventHandlers.push([EVENTS.OPEN_MULTI_CHART, onOpen]);
  },

  open(sensorIds = []) {
    // Preset sensors if provided (e.g., from SensorDetailModal "Compare" button)
    if (sensorIds.length > 0) {
      ChartStore.reset();
      sensorIds.slice(0, ChartStore.config.maxSeries).forEach(id => ChartStore.addSeries(id));
    } else if (ChartStore.activeSeries.length === 0) {
      // Default: first 3 sensors in process order
      SENSORS.slice(0, 3).forEach(s => ChartStore.addSeries(s.id));
    }

    this._overlay.classList.add('visible');
    this._renderSensorPicker();
    this._renderSeriesPanel();
    this._buildChartCards();
    this._renderAllCharts();
    this._renderAnalytics();

    this._updateTimer = setInterval(() => {
      this._renderAllCharts();
      this._renderAnalytics();
    }, 500);
  },

  close() {
    this._overlay?.classList.remove('visible');
    clearInterval(this._updateTimer);
    this._updateTimer = null;
    // Clear hover on close
    ChartStore.clearHover();
  },

  // ─── DOM build ──────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'mc-overlay';
    el.innerHTML = `
      <div id="mc-panel" role="dialog" aria-modal="true" aria-label="Multi-Sensor Analysis">

        <div id="mc-header">
          <div id="mc-header-left">
            <span id="mc-title">Multi-Sensor Analysis</span>
            <span id="mc-source-badge">● No source</span>
          </div>
          <div id="mc-header-right">
            <div class="mc-btn-group">
              <button class="mc-btn mc-toggle-btn mc-btn--active" data-config="chartType" data-value="line" title="Line chart">Line</button>
              <button class="mc-btn mc-toggle-btn" data-config="chartType" data-value="scatter" title="Scatter plot">Scatter</button>
            </div>
            <div class="mc-btn-sep"></div>
            <button id="mc-btn-deriv" class="mc-btn mc-toggle-btn" data-config="showDerivative" title="Show rate of change">∂ Rate</button>
            <button id="mc-btn-anomalies" class="mc-btn mc-toggle-btn" data-config="showAnomalies" title="Highlight anomalies">⚑ Anomalies</button>
            <div class="mc-btn-sep"></div>
            <button id="mc-btn-econ-cost" class="mc-btn mc-toggle-btn" data-config="showEconomicCost" title="Accumulated cost overlay">€ Cost</button>
            <button id="mc-btn-econ-corr" class="mc-btn mc-toggle-btn" data-config="showEconomicCorrelation" title="Economic correlation in sidebar">≈ Corr</button>
            <button id="mc-btn-econ-impact" class="mc-btn mc-toggle-btn" data-config="showEconomicImpact" title="Combined economic impact chart">⚡ Impact</button>
            <button id="mc-btn-fin-cfg" class="mc-btn" title="Financial analytics configuration">⚙ Fin</button>
            <div class="mc-btn-sep"></div>
            <button id="mc-btn-zoom-reset" class="mc-btn" title="Reset zoom to full history">↺ Reset zoom</button>
            <div class="mc-btn-sep"></div>
            <div class="mc-btn-group" id="mc-timewindow-group">
              <button class="mc-btn mc-tw-btn" data-tw="30"  title="Last 30 seconds">30s</button>
              <button class="mc-btn mc-tw-btn" data-tw="60"  title="Last 1 minute">1m</button>
              <button class="mc-btn mc-tw-btn" data-tw="120" title="Last 2 minutes">2m</button>
              <button class="mc-btn mc-tw-btn mc-btn--active" data-tw="0" title="Show all history">All</button>
            </div>
            <div class="mc-btn-sep"></div>
            <div class="mc-dropdown-wrap">
              <button id="mc-btn-export" class="mc-btn" title="Export data">↓ Export</button>
              <div id="mc-export-menu" class="mc-dropdown" style="display:none">
                <button class="mc-dropdown-item" id="mc-export-csv">CSV — all series</button>
                <button class="mc-dropdown-item" id="mc-export-clipboard">Clipboard (TSV)</button>
                <button class="mc-dropdown-item" id="mc-export-config">Chart config (JSON)</button>
                <button class="mc-dropdown-item" id="mc-export-png">PNG snapshot</button>
              </div>
            </div>
            <button id="mc-close" class="mc-btn mc-btn--close" title="Close panel" aria-label="Close">✕</button>
          </div>
        </div>

        <div id="mc-body">

          <div id="mc-sidebar">
            <div class="mc-sidebar-section">
              <div class="mc-sidebar-label">ADD SENSOR</div>
              <div id="mc-sensor-picker"></div>
            </div>
            <div class="mc-sidebar-section">
              <div class="mc-sidebar-label">ACTIVE SERIES</div>
              <div id="mc-series-panel"></div>
            </div>
            <div class="mc-sidebar-section" id="mc-analytics-section">
              <div class="mc-sidebar-label">ANALYTICS</div>
              <div id="mc-analytics-body"></div>
            </div>
            <div class="mc-sidebar-section" id="mc-compare-section" style="display:none">
              <div class="mc-sidebar-label">BEFORE / AFTER</div>
              <div id="mc-compare-body"></div>
            </div>
            <div class="mc-sidebar-section" id="mc-correlation-section" style="display:none">
              <div class="mc-sidebar-label">CORRELATIONS</div>
              <div id="mc-correlation-body"></div>
            </div>
            <div class="mc-sidebar-section" id="mc-econ-corr-section" style="display:none">
              <div class="mc-sidebar-label">ECONOMIC CORRELATION</div>
              <div id="mc-econ-corr-body"></div>
            </div>
          </div>

          <div id="mc-charts-area">
            <div id="mc-zoom-hint">
              Scroll to zoom · Drag to pan · Hover for crosshair details
            </div>
            <div id="mc-charts-container"></div>
            <div id="mc-no-sensors">
              <div class="mc-no-sensors-icon">⊞</div>
              <div>Select sensors from the left panel to compare</div>
            </div>
            <div id="mc-economic-chart-wrap" style="display:none; padding: 0 8px 8px;">
              <div class="mc-chart-card">
                <div class="mc-card-header">
                  <div class="mc-card-header-left">
                    <span class="mc-card-title">Combined economic impact</span>
                    <span class="mc-card-unit">€/2h</span>
                  </div>
                </div>
                <div class="mc-card-chart-wrap">
                  <svg id="mc-econ-svg" viewBox="0 0 ${CW} 80" preserveAspectRatio="none"
                       style="width:100%;height:80px;display:block;cursor:crosshair">
                    <defs>
                      <clipPath id="mc-econ-clip">
                        <rect x="${PAD.left}" y="${PAD.top}" width="${ICW}" height="${80 - PAD.top - PAD.bottom}"/>
                      </clipPath>
                    </defs>
                    <g id="mc-econ-zones"  clip-path="url(#mc-econ-clip)"></g>
                    <g id="mc-econ-areas"  clip-path="url(#mc-econ-clip)"></g>
                    <g id="mc-econ-line"   clip-path="url(#mc-econ-clip)"></g>
                    <g id="mc-econ-events" clip-path="url(#mc-econ-clip)"></g>
                    <g id="mc-econ-ylabels"></g>
                    <line id="mc-econ-xhair" x1="0" y1="${PAD.top}" x2="0" y2="${80 - PAD.bottom}"
                          stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="3,3"
                          display="none" clip-path="url(#mc-econ-clip)"/>
                    <rect id="mc-econ-hover-rect"
                          x="${PAD.left}" y="${PAD.top}" width="${ICW}" height="${80 - PAD.top - PAD.bottom}"
                          fill="transparent"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    // ── Close ───────────────────────────────────────────────────────────────
    document.getElementById('mc-close').addEventListener('click', () => this.close());
    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.classList.contains('visible')) this.close();
    });

    // ── Zoom reset ──────────────────────────────────────────────────────────
    document.getElementById('mc-btn-zoom-reset').addEventListener('click', () => {
      ChartStore.resetZoom();
      this._renderAllCharts();
    });

    // ── Config toggles ──────────────────────────────────────────────────────
    el.querySelectorAll('.mc-toggle-btn[data-config]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.config;
        const val = btn.dataset.value;

        if (val !== undefined) {
          // Radio-style: deactivate siblings with same data-config
          el.querySelectorAll(`.mc-toggle-btn[data-config="${key}"]`).forEach(b => b.classList.remove('mc-btn--active'));
          ChartStore.setConfig(key, val);
          btn.classList.add('mc-btn--active');
        } else {
          // Boolean toggle
          ChartStore.toggleConfig(key);
          btn.classList.toggle('mc-btn--active', ChartStore.config[key]);
        }
        this._renderAllCharts();
      });
    });

    // ── Export menu ─────────────────────────────────────────────────────────
    document.getElementById('mc-btn-export').addEventListener('click', e => {
      e.stopPropagation();
      const menu = document.getElementById('mc-export-menu');
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      document.getElementById('mc-export-menu')?.style && (document.getElementById('mc-export-menu').style.display = 'none');
    });
    document.getElementById('mc-export-csv').addEventListener('click',       () => this._exportCSV());
    document.getElementById('mc-export-clipboard').addEventListener('click', () => this._exportClipboard());
    document.getElementById('mc-export-config').addEventListener('click',    () => this._exportConfig());
    document.getElementById('mc-export-png').addEventListener('click',       () => this._exportPNG());

    // ── Time window buttons ─────────────────────────────────────────────────
    el.querySelectorAll('.mc-tw-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.mc-tw-btn').forEach(b => b.classList.remove('mc-btn--active'));
        btn.classList.add('mc-btn--active');
        const tw = parseInt(btn.dataset.tw, 10);
        if (tw === 0) {
          ChartStore.resetZoom();
        } else {
          this._setTimeWindow(tw * 1000);
        }
        this._renderAllCharts();
      });
    });

    // ── Financial config button ─────────────────────────────────────────────
    document.getElementById('mc-btn-fin-cfg')?.addEventListener('click', () => {
      ConfigModal.openAtSection('config-financial');
    });

    // ── Economic hover on impact chart ──────────────────────────────────────
    document.getElementById('mc-econ-hover-rect')?.addEventListener('mousemove', e => {
      const rect = document.getElementById('mc-econ-svg')?.getBoundingClientRect();
      if (!rect) return;
      const svgX = (e.clientX - rect.left) * (CW / rect.width);
      const frac = Math.max(0, Math.min(1, (svgX - PAD.left) / ICW));
      ChartStore.setHoverFrac(frac);
    });
    document.getElementById('mc-econ-hover-rect')?.addEventListener('mouseleave', () => ChartStore.clearHover());

    // ── ChartStore subscriptions ────────────────────────────────────────────
    this._unsubscribers.push(
      ChartStore.subscribe('series', () => {
        this._renderSensorPicker();
        this._renderSeriesPanel();
        this._buildChartCards();
        this._renderAllCharts();
        this._renderAnalytics();
      }),
      ChartStore.subscribe('zoom', () => {
        this._renderAllCharts();
      }),
      ChartStore.subscribe('hover', frac => {
        this._syncCrosshairs(frac);
      }),
    );

    // ── Listen to DataSourceManager mode for source badge ──────────────────
    const onSource = ({ mode }) => this._updateSourceBadge(mode);
    EventBus.on(EVENTS.DATA_SOURCE_CHANGED, onSource);
    this._eventHandlers.push([EVENTS.DATA_SOURCE_CHANGED, onSource]);
  },

  // ─── Sensor picker (sidebar "ADD SENSOR") ────────────────────────────────────

  _renderSensorPicker() {
    const container = document.getElementById('mc-sensor-picker');
    if (!container) return;
    container.innerHTML = '';

    SENSORS.forEach(sensor => {
      const isActive = ChartStore.hasSeries(sensor.id);
      const atMax    = ChartStore.activeSeries.length >= ChartStore.config.maxSeries;

      const pill = document.createElement('button');
      pill.className   = `mc-sensor-pill ${isActive ? 'is-active' : ''}`;
      pill.textContent = sensor.label;
      pill.title       = `${sensor.label} (${sensor.unit})`;
      pill.disabled    = !isActive && atMax;

      pill.addEventListener('click', () => {
        if (isActive) {
          ChartStore.removeSeries(sensor.id);
        } else {
          ChartStore.addSeries(sensor.id);
        }
      });
      container.appendChild(pill);
    });
  },

  // ─── Series panel (sidebar "ACTIVE SERIES") ──────────────────────────────────

  _renderSeriesPanel() {
    const container = document.getElementById('mc-series-panel');
    if (!container) return;

    if (ChartStore.activeSeries.length === 0) {
      container.innerHTML = '<span class="mc-empty-hint">No sensors selected</span>';
      return;
    }

    container.innerHTML = '';
    ChartStore.activeSeries.forEach(({ sensorId, visible, color }) => {
      const config = SENSORS.find(s => s.id === sensorId);
      if (!config) return;

      const row = document.createElement('div');
      row.className = 'mc-series-row';
      row.innerHTML = `
        <span class="mc-series-dot" style="background:${color}"></span>
        <span class="mc-series-name">${config.label}</span>
        <button class="mc-series-toggle ${visible ? '' : 'is-hidden'}" data-id="${sensorId}" title="${visible ? 'Hide' : 'Show'}">
          ${visible ? '◉' : '◎'}
        </button>
        <button class="mc-series-remove" data-id="${sensorId}" title="Remove">×</button>
      `;
      row.querySelector('.mc-series-toggle').addEventListener('click', () => ChartStore.toggleSeries(sensorId));
      row.querySelector('.mc-series-remove').addEventListener('click', () => ChartStore.removeSeries(sensorId));
      container.appendChild(row);
    });
  },

  // ─── Chart cards DOM management ───────────────────────────────────────────────

  _buildChartCards() {
    const container = document.getElementById('mc-charts-container');
    const noSensors = document.getElementById('mc-no-sensors');
    if (!container) return;

    const activeIds = ChartStore.activeSeries.map(s => s.sensorId);
    noSensors.style.display = activeIds.length === 0 ? 'flex' : 'none';

    // Remove cards for sensors no longer active
    container.querySelectorAll('.mc-chart-card').forEach(card => {
      if (!activeIds.includes(card.dataset.sensorId)) card.remove();
    });

    // Add cards for new sensors (maintain order)
    activeIds.forEach((sensorId, idx) => {
      if (container.querySelector(`.mc-chart-card[data-sensor-id="${sensorId}"]`)) return;
      const card = this._createChartCard(sensorId);
      const nextCard = container.children[idx];
      nextCard ? container.insertBefore(card, nextCard) : container.appendChild(card);
    });
  },

  _createChartCard(sensorId) {
    const config = SENSORS.find(s => s.id === sensorId);
    if (!config) return document.createElement('div');

    const card = document.createElement('div');
    card.className       = 'mc-chart-card';
    card.dataset.sensorId = sensorId;

    const safeId = sensorId.replace(/[^a-z0-9]/gi, '_');

    card.innerHTML = `
      <div class="mc-card-header">
        <div class="mc-card-header-left">
          <span class="mc-card-title">${config.label}</span>
          <span class="mc-card-unit">${config.unit}</span>
          <span class="mc-card-badge sd-badge" id="mc-badge-${safeId}"></span>
        </div>
        <div class="mc-card-header-right">
          <span class="mc-card-value" id="mc-value-${safeId}">—</span>
          <span class="mc-card-trend" id="mc-trend-${safeId}"></span>
          <button class="mc-card-remove" data-sensor-id="${sensorId}" title="Remove sensor">×</button>
        </div>
      </div>
      <div class="mc-card-chart-wrap">
        <svg class="mc-chart" data-sensor-id="${sensorId}"
             viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none">
          <defs>
            <clipPath id="mc-clip-${safeId}">
              <rect x="${PAD.left}" y="${PAD.top}" width="${ICW}" height="${ICH}"/>
            </clipPath>
          </defs>
          <g class="mc-zones"     clip-path="url(#mc-clip-${safeId})"></g>
          <g class="mc-ref-lines" clip-path="url(#mc-clip-${safeId})"></g>
          <g class="mc-areas"     clip-path="url(#mc-clip-${safeId})"></g>
          <g class="mc-lines"     clip-path="url(#mc-clip-${safeId})"></g>
          <g class="mc-deriv"     clip-path="url(#mc-clip-${safeId})" style="display:none"></g>
          <g class="mc-anomalies" clip-path="url(#mc-clip-${safeId})" style="display:none"></g>
          <g class="mc-events"     clip-path="url(#mc-clip-${safeId})"></g>
          <g class="mc-cost-line"  clip-path="url(#mc-clip-${safeId})" style="display:none"></g>
          <g class="mc-cost-axis"></g>
          <g class="mc-y-labels"></g>
          <g class="mc-x-labels"></g>
          <line class="mc-xhair-line" x1="0" y1="${PAD.top}" x2="0" y2="${CH - PAD.bottom}" display="none" clip-path="url(#mc-clip-${safeId})"/>
          <circle class="mc-xhair-dot" r="3" cx="0" cy="0" display="none" stroke-width="1.5"/>
          <rect class="mc-hover-rect"
                x="${PAD.left}" y="${PAD.top}" width="${ICW}" height="${ICH}"
                fill="transparent" style="cursor:crosshair"/>
        </svg>
        <div class="mc-tooltip mc-tooltip-${safeId}" style="display:none"></div>
      </div>
      <div class="mc-minimap-wrap" data-sensor-id="${sensorId}">
        <svg class="mc-minimap" data-sensor-id="${sensorId}"
             viewBox="0 0 ${CW} 28" preserveAspectRatio="none">
          <g class="mc-mm-line"></g>
          <rect class="mc-mm-window" x="0" y="0" width="${CW}" height="28"
                fill="rgba(96,165,250,0.12)" stroke="rgba(96,165,250,0.45)"
                stroke-width="1" rx="0"/>
        </svg>
      </div>
      <div class="mc-card-stats" id="mc-stats-${safeId}"></div>
    `;

    // Remove button
    card.querySelector('.mc-card-remove').addEventListener('click', () => {
      ChartStore.removeSeries(sensorId);
    });

    // Hover / zoom / drag
    const svgEl     = card.querySelector('.mc-chart');
    const hoverRect = card.querySelector('.mc-hover-rect');

    hoverRect.addEventListener('mousemove',  e => this._onChartHover(e, sensorId, svgEl));
    hoverRect.addEventListener('mouseleave', () => ChartStore.clearHover());
    hoverRect.addEventListener('wheel',      e => this._onChartWheel(e, sensorId, svgEl), { passive: false });
    hoverRect.addEventListener('mousedown',  e => this._onDragStart(e, svgEl));

    // Minimap interaction: click to center + drag to pan zoom window
    const minimapSvg = card.querySelector('.mc-minimap');
    if (minimapSvg) {
      minimapSvg.addEventListener('click', e => {
        const rect = minimapSvg.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const { startFrac, endFrac } = ChartStore.zoomWindow;
        const half  = (endFrac - startFrac) / 2;
        ChartStore.setZoom(frac - half, frac + half);
        this._renderAllCharts();
      });
      minimapSvg.addEventListener('mousedown', e => this._onMinimapDrag(e, minimapSvg));
    }

    return card;
  },

  // ─── Zoom / pan interaction ───────────────────────────────────────────────────

  _onChartHover(e, sensorId, svgEl) {
    const rect  = svgEl.getBoundingClientRect();
    const svgX  = (e.clientX - rect.left) * (CW / rect.width);
    const frac  = Math.max(0, Math.min(1, (svgX - PAD.left) / ICW));
    ChartStore.setHoverFrac(frac);
    // Tooltip is handled in _syncCrosshairs
    this._updateTooltip(frac, sensorId);
  },

  _onChartWheel(e, sensorId, svgEl) {
    e.preventDefault();
    const rect      = svgEl.getBoundingClientRect();
    const svgX      = (e.clientX - rect.left) * (CW / rect.width);
    const hoverFrac = Math.max(0, Math.min(1, (svgX - PAD.left) / ICW));

    // Compute absolute fraction in full data space
    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const absFrac = startFrac + hoverFrac * (endFrac - startFrac);

    // Zoom factor: wheel up = zoom in (0.77), wheel down = zoom out (1.3)
    const factor = e.deltaY > 0 ? 1.3 : 0.77;
    ChartStore.zoomAround(absFrac, factor);
  },

  _onDragStart(e, svgEl) {
    if (e.button !== 0) return;
    this._dragState = { startX: e.clientX, startZoom: { ...ChartStore.zoomWindow }, svgEl };

    const onMove = ev => {
      if (!this._dragState) return;
      const rect    = this._dragState.svgEl.getBoundingClientRect();
      const dx      = (ev.clientX - this._dragState.startX) / rect.width;
      const range   = this._dragState.startZoom.endFrac - this._dragState.startZoom.startFrac;
      const shift   = -dx * range;   // drag right → pan to earlier data
      ChartStore.setZoom(
        this._dragState.startZoom.startFrac + shift,
        this._dragState.startZoom.endFrac   + shift,
      );
    };

    const onUp = () => {
      this._dragState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  },

  // ─── Crosshair sync (called by ChartStore 'hover' event) ─────────────────────

  _syncCrosshairs(hoverFrac) {
    const cards = document.querySelectorAll('.mc-chart-card');
    cards.forEach(card => {
      const sensorId = card.dataset.sensorId;
      const svgEl    = card.querySelector('.mc-chart');
      const xhairL   = card.querySelector('.mc-xhair-line');
      const xhairD   = card.querySelector('.mc-xhair-dot');

      if (hoverFrac === null || hoverFrac === undefined) {
        xhairL?.setAttribute('display', 'none');
        xhairD?.setAttribute('display', 'none');
        const safeId = sensorId.replace(/[^a-z0-9]/gi, '_');
        const tip = card.querySelector(`.mc-tooltip-${safeId}`);
        if (tip) tip.style.display = 'none';
        return;
      }

      // Map fraction to visible data index
      const history = SensorState.getHistory(sensorId);
      if (history.length < 2) return;

      const { startFrac, endFrac } = ChartStore.zoomWindow;
      const startIdx = Math.floor(history.length * startFrac);
      const endIdx   = Math.ceil(history.length * endFrac);
      const visible  = history.slice(startIdx, endIdx);
      if (visible.length < 2) return;

      const dataIdx  = Math.round(hoverFrac * (visible.length - 1));
      const point    = visible[dataIdx];
      if (!point || typeof point.value !== 'number') return;

      // SVG x position
      const cx = PAD.left + hoverFrac * ICW;

      // SVG y position (needs scale — approximate from current render data)
      const values  = visible.map(h => h.value).filter(v => isFinite(v));
      const config  = SENSORS.find(s => s.id === sensorId);
      if (!values.length || !config) return;

      const yMin   = Math.min(config.rangeMin, ...values);
      const yMax   = Math.max(config.rangeMax, ...values);
      const yRange = yMax - yMin || 1;
      const scaleY = v => PAD.top + (1 - (v - yMin) / yRange) * ICH;
      const cy     = scaleY(point.value);
      const state  = getSensorState(sensorId, point.value);
      const col    = COL[state]?.line ?? '#22c55e';

      if (xhairL) { xhairL.setAttribute('x1', cx); xhairL.setAttribute('x2', cx); xhairL.removeAttribute('display'); }
      if (xhairD) { xhairD.setAttribute('cx', cx); xhairD.setAttribute('cy', cy); xhairD.setAttribute('fill', col); xhairD.setAttribute('stroke', 'rgba(11,12,14,0.8)'); xhairD.removeAttribute('display'); }
    });
  },

  _updateTooltip(hoverFrac, sensorId) {
    const safeId = sensorId.replace(/[^a-z0-9]/gi, '_');
    const card   = document.querySelector(`.mc-chart-card[data-sensor-id="${sensorId}"]`);
    const tip    = card?.querySelector(`.mc-tooltip-${safeId}`);
    const svgEl  = card?.querySelector('.mc-chart');
    if (!tip || !svgEl) return;

    const history = SensorState.getHistory(sensorId);
    if (history.length < 2) return;

    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const startIdx = Math.floor(history.length * startFrac);
    const endIdx   = Math.ceil(history.length * endFrac);
    const visible  = history.slice(startIdx, endIdx);
    if (!visible.length) return;

    const dataIdx = Math.round(hoverFrac * (visible.length - 1));
    const point   = visible[dataIdx];
    if (!point || typeof point.value !== 'number') return;

    const config   = SENSORS.find(s => s.id === sensorId);
    const state    = getSensorState(sensorId, point.value);
    const col      = COL[state]?.line ?? '#22c55e';
    const stateLbl = { normal: 'Normal', warning: 'Warning', danger: 'Danger' }[state] ?? '—';
    const ago      = Math.floor((Date.now() - point.timestamp) / 1000);
    const timeStr  = ago < 3 ? 'now' : ago < 60 ? `${ago}s` : `${Math.floor(ago/60)}m ${String(ago%60).padStart(2,'0')}s`;
    const valStr   = this._fmtHigh(point.value, config);

    tip.innerHTML = `
      <div class="mc-tt-value" style="color:${col}">${valStr}<span class="mc-tt-unit"> ${config.unit}</span></div>
      <div class="mc-tt-time">${timeStr} ago</div>
      <div class="mc-tt-state" style="color:${col}">${stateLbl}</div>
    `;

    // Position tooltip relative to chart-wrap
    const rect     = svgEl.getBoundingClientRect();
    const wrapRect = card.querySelector('.mc-card-chart-wrap').getBoundingClientRect();
    const cx       = PAD.left + hoverFrac * ICW;
    const tipX     = (cx / CW) * rect.width + (rect.left - wrapRect.left);
    const TIP_W    = 115;

    tip.style.left    = `${tipX + TIP_W + 8 > wrapRect.width ? tipX - TIP_W - 6 : tipX + 6}px`;
    tip.style.top     = '4px';
    tip.style.display = 'block';
  },

  // ─── Full chart render ────────────────────────────────────────────────────────

  _renderAllCharts() {
    ChartStore.activeSeries.forEach(({ sensorId, visible }) => {
      if (!visible) return;
      this._renderChart(sensorId);
    });
    this._renderEconomicImpactChart();
    this._updateSourceBadgeFromState();
  },

  _renderChart(sensorId) {
    const card = document.querySelector(`.mc-chart-card[data-sensor-id="${sensorId}"]`);
    if (!card) return;

    const svgEl  = card.querySelector('.mc-chart');
    const config = SENSORS.find(s => s.id === sensorId);
    if (!svgEl || !config) return;

    const safeId = sensorId.replace(/[^a-z0-9]/gi, '_');

    // ── Get visible history (respecting zoom) ─────────────────────────────
    const fullHistory = SensorState.getHistory(sensorId);
    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const startIdx  = Math.floor(fullHistory.length * startFrac);
    const endIdx    = Math.ceil(fullHistory.length * endFrac);
    const history   = fullHistory.slice(startIdx, endIdx);
    const values    = history.map(h => h.value).filter(v => typeof v === 'number' && isFinite(v));

    // ── Current value + badge ─────────────────────────────────────────────
    const current = SensorState.get(sensorId);
    const state   = current !== undefined ? getSensorState(sensorId, current) : 'unknown';
    const colVar  = { normal: 'var(--green)', warning: 'var(--amber)', danger: 'var(--red)' }[state] ?? 'var(--text2)';

    const valEl   = document.getElementById(`mc-value-${safeId}`);
    const badgeEl = document.getElementById(`mc-badge-${safeId}`);
    if (valEl && current !== undefined) { valEl.textContent = this._fmt(current, config); valEl.style.color = colVar; }
    if (badgeEl) { badgeEl.textContent = state.charAt(0).toUpperCase() + state.slice(1); badgeEl.className = `mc-card-badge sd-badge sd-badge--${state}`; }

    // ── Trend ─────────────────────────────────────────────────────────────
    if (values.length >= 4) {
      const trend    = computeTrend(history.filter(h => typeof h.value === 'number'));
      const trendEl  = document.getElementById(`mc-trend-${safeId}`);
      if (trendEl && trend) {
        trendEl.textContent = formatTrend(trend, config.unit);
        trendEl.style.color = trend.direction === 'stable' ? 'var(--text2)' :
                              trend.direction === 'rising'  ? 'var(--amber)' : 'var(--blue)';
      }
    }

    // ── No data ───────────────────────────────────────────────────────────
    if (values.length < 2) return;

    // ── Scale ─────────────────────────────────────────────────────────────
    const yMin   = Math.min(config.rangeMin, ...values);
    const yMax   = Math.max(config.rangeMax, ...values);
    const yRange = yMax - yMin || 1;
    const n      = values.length;

    const scaleX = i => PAD.left + (i / Math.max(1, n - 1)) * ICW;
    const scaleY = v => PAD.top  + (1 - (v - yMin) / yRange) * ICH;
    const baseY  = scaleY(yMin);

    // ── Chart layers ──────────────────────────────────────────────────────
    this._renderZoneBands(svgEl, config, scaleY, yMin, yMax);
    this._renderRefLines(svgEl, config, scaleY, yMin, yMax);
    this._renderSegments(svgEl, history, values, scaleX, scaleY, baseY, sensorId);
    this._renderYLabels(svgEl, yMin, yMax, scaleY, config);
    this._renderXLabels(svgEl, history, scaleX);

    // ── Derivative overlay ────────────────────────────────────────────────
    const derivGroup = svgEl.querySelector('.mc-deriv');
    if (derivGroup) {
      const show = ChartStore.config.showDerivative;
      derivGroup.style.display = show ? '' : 'none';
      if (show) this._renderDerivative(derivGroup, history, scaleX, yMin, yMax, scaleY);
    }

    // ── Anomaly overlay ───────────────────────────────────────────────────
    const anomGroup = svgEl.querySelector('.mc-anomalies');
    if (anomGroup) {
      const show = ChartStore.config.showAnomalies;
      anomGroup.style.display = show ? '' : 'none';
      if (show) this._renderAnomalies(anomGroup, history, scaleX, scaleY, sensorId);
    }

    // ── Economic cost overlay ─────────────────────────────────────────────
    const costGroup = svgEl.querySelector('.mc-cost-line');
    const costAxis  = svgEl.querySelector('.mc-cost-axis');
    if (costGroup && costAxis) {
      const showCost = ChartStore.config.showEconomicCost && FinancialConfig.get().costPerUnit.enabled;
      costGroup.style.display = showCost ? '' : 'none';
      costAxis.innerHTML = '';
      if (showCost) this._renderEconomicCostLine(svgEl, history, scaleX);
    }

    // ── Stats bar ─────────────────────────────────────────────────────────
    const statsEl = document.getElementById(`mc-stats-${safeId}`);
    if (statsEl && ChartStore.config.showStats) {
      const stats = computeStats(values);
      if (stats) {
        statsEl.innerHTML = `
          <span class="mc-stat">Min <b>${this._fmt(stats.min, config)}</b></span>
          <span class="mc-stat">Avg <b>${this._fmt(stats.mean, config)}</b></span>
          <span class="mc-stat">Max <b>${this._fmt(stats.max, config)}</b></span>
          <span class="mc-stat">σ <b>${this._fmt(stats.std, config)}</b></span>
          <span class="mc-stat">n=<b>${stats.n}</b></span>
        `;
      }
    }

    // ── Event markers ─────────────────────────────────────────────────────
    this._renderEventMarkers(svgEl, history);

    // ── Minimap navigator ─────────────────────────────────────────────────
    const minimapWrap = card.querySelector('.mc-minimap-wrap');
    if (minimapWrap) this._renderMinimap(minimapWrap.querySelector('.mc-minimap'), fullHistory, config);
  },

  // ─── SVG rendering helpers ───────────────────────────────────────────────────

  _renderZoneBands(svgEl, config, scaleY, yMin, yMax) {
    const g = svgEl.querySelector('.mc-zones');
    if (!g) return;
    g.innerHTML = '';

    const addBand = (vLow, vHigh, fill) => {
      const cLow  = Math.max(yMin, Math.min(yMax, vLow));
      const cHigh = Math.max(yMin, Math.min(yMax, vHigh));
      if (cLow >= cHigh) return;
      const y1 = scaleY(cHigh), ht = scaleY(cLow) - y1;
      if (ht < 0.5) return;
      g.appendChild(svg('rect', { x: PAD.left, y: y1, width: ICW, height: ht, fill }));
    };

    addBand(config.warning.low,  config.warning.high, COL.normal.band);
    addBand(config.danger.low,   config.warning.low,  COL.warning.band);
    addBand(config.warning.high, config.danger.high,  COL.warning.band);
    addBand(yMin,                config.danger.low,   COL.danger.band);
    addBand(config.danger.high,  yMax,                COL.danger.band);
  },

  _renderRefLines(svgEl, config, scaleY, yMin, yMax) {
    const g = svgEl.querySelector('.mc-ref-lines');
    if (!g) return;
    g.innerHTML = '';

    [
      { v: config.warning.low,  stroke: '#f59e0b', dash: '4,3' },
      { v: config.warning.high, stroke: '#f59e0b', dash: '4,3' },
      { v: config.danger.low,   stroke: '#ef4444', dash: '3,4' },
      { v: config.danger.high,  stroke: '#ef4444', dash: '3,4' },
    ].forEach(({ v, stroke, dash }) => {
      if (v <= yMin || v >= yMax) return;
      const y = scaleY(v).toFixed(1);
      g.appendChild(svg('line', {
        x1: PAD.left, x2: CW - PAD.right, y1: y, y2: y,
        stroke, 'stroke-width': '0.6', 'stroke-dasharray': dash, opacity: '0.5',
      }));
    });
  },

  _renderSegments(svgEl, history, values, scaleX, scaleY, baseY, sensorId) {
    const areasG = svgEl.querySelector('.mc-areas');
    const linesG = svgEl.querySelector('.mc-lines');
    if (!areasG || !linesG) return;
    areasG.innerHTML = '';
    linesG.innerHTML = '';

    // Scatter mode
    if (ChartStore.config.chartType === 'scatter') {
      history.forEach((point, i) => {
        if (typeof point.value !== 'number' || !isFinite(point.value)) return;
        const state = getSensorState(sensorId, point.value);
        linesG.appendChild(svg('circle', {
          cx: scaleX(i).toFixed(1), cy: scaleY(point.value).toFixed(1),
          r: '2', fill: COL[state]?.line ?? '#22c55e', opacity: '0.8',
        }));
      });
      return;
    }

    // Line mode: group into state runs
    const groups = [];
    let current  = null;

    history.forEach((point, i) => {
      if (typeof point.value !== 'number' || !isFinite(point.value)) return;
      const px    = scaleX(i);
      const py    = scaleY(point.value);
      const state = getSensorState(sensorId, point.value);

      if (!current || current.state !== state) {
        if (current) current.pts.push({ x: px, y: py });
        current = { state, pts: [{ x: px, y: py }] };
        groups.push(current);
      } else {
        current.pts.push({ x: px, y: py });
      }
    });

    groups.forEach(({ state, pts }) => {
      if (pts.length < 2) return;
      const col   = COL[state] ?? COL.normal;
      const dLine = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const first = pts[0], last = pts[pts.length - 1];
      areasG.appendChild(svg('path', {
        d:    `${dLine} L${last.x.toFixed(1)},${baseY.toFixed(1)} L${first.x.toFixed(1)},${baseY.toFixed(1)} Z`,
        fill: col.area,
      }));
      linesG.appendChild(svg('path', {
        d: dLine, fill: 'none', stroke: col.line,
        'stroke-width': '1.4', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    });
  },

  _renderDerivative(g, history, scaleX, yMin, yMax, scaleY) {
    g.innerHTML = '';
    const deriv = computeDerivative(history.filter(h => typeof h.value === 'number'));
    if (deriv.length < 2) return;

    const dValues = deriv.map(d => d.value);
    const dMin    = Math.min(...dValues);
    const dMax    = Math.max(...dValues);
    const dRange  = dMax - dMin || 1;

    // Normalize derivative to same Y space as main chart
    const scaleDerivY = v => PAD.top + (1 - (v - dMin) / dRange) * ICH;

    const pts = deriv.map((d, i) => {
      const x = PAD.left + ((i + 1) / Math.max(1, history.length - 1)) * ICW;
      const y = scaleDerivY(d.value);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    g.appendChild(svg('path', {
      d: pts.join(' '), fill: 'none', stroke: COL.deriv.line,
      'stroke-width': '1', opacity: '0.7',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': '4,2',
    }));
  },

  _renderAnomalies(g, history, scaleX, scaleY, sensorId) {
    g.innerHTML = '';
    const anomalies = detectAnomalies(history.filter(h => typeof h.value === 'number'), { zThreshold: 2.5 });
    anomalies
      .filter(a => a.isAnomaly)
      .forEach(a => {
        g.appendChild(svg('circle', {
          cx: scaleX(a.index).toFixed(1), cy: scaleY(a.value).toFixed(1),
          r: '4', fill: 'none', stroke: COL.anomaly,
          'stroke-width': '1.5', opacity: '0.9',
        }));
      });
  },

  // ─── Event markers (alert/scenario vertical lines) ────────────────────────────

  _renderEventMarkers(svgEl, history) {
    const g = svgEl.querySelector('.mc-events');
    if (!g) return;
    g.innerHTML = '';
    if (history.length < 2) return;

    const startTs = history[0].timestamp;
    const endTs   = history[history.length - 1].timestamp;
    const timeRange = endTs - startTs || 1;

    const markers = EventMarkers.getInRange(startTs, endTs);
    markers.forEach(marker => {
      const frac = (marker.timestamp - startTs) / timeRange;
      const x    = (PAD.left + frac * ICW).toFixed(1);
      const col  = marker.severity === 'danger' ? '#ef4444' : '#f59e0b';

      // Vertical dashed line
      g.appendChild(svg('line', {
        x1: x, y1: PAD.top, x2: x, y2: CH - PAD.bottom,
        stroke: col, 'stroke-width': '1.2',
        'stroke-dasharray': '3,3', opacity: '0.75',
      }));

      // Small flag triangle at top
      const tx = parseFloat(x);
      g.appendChild(svg('polygon', {
        points: `${tx},${PAD.top} ${tx + 6},${PAD.top} ${tx},${PAD.top + 7}`,
        fill: col, opacity: '0.9',
      }));
    });
  },

  // ─── Minimap navigator ───────────────────────────────────────────────────────

  _renderMinimap(minimapSvg, fullHistory, config) {
    if (!minimapSvg) return;
    const lineG  = minimapSvg.querySelector('.mc-mm-line');
    const winEl  = minimapSvg.querySelector('.mc-mm-window');
    if (!lineG || !winEl) return;

    const MM_H = 28;
    const MM_W = CW;
    const values = fullHistory.map(h => h.value).filter(v => typeof v === 'number' && isFinite(v));
    if (values.length < 2) return;

    lineG.innerHTML = '';

    const yMin = Math.min(config.rangeMin ?? 0, ...values);
    const yMax = Math.max(config.rangeMax ?? 1, ...values);
    const yRange = yMax - yMin || 1;
    const n = values.length;

    // Downsample to max 200 pts for performance
    const sampled = values.length > 200 ? (() => {
      const step = Math.ceil(n / 200);
      return fullHistory.filter((_, i) => i % step === 0 || i === n - 1);
    })() : fullHistory;

    const mmScaleX = i  => (i / Math.max(1, n - 1)) * MM_W;
    const mmScaleY = v  => 2 + (1 - (v - yMin) / yRange) * (MM_H - 4);

    // Build mini polyline from sampled data
    const pts = sampled
      .filter(h => typeof h.value === 'number' && isFinite(h.value))
      .map(h => {
        const origIdx = fullHistory.indexOf(h);
        const x = mmScaleX(origIdx).toFixed(1);
        const y = mmScaleY(h.value).toFixed(1);
        return `${x},${y}`;
      }).join(' ');

    if (pts) {
      lineG.appendChild(svg('polyline', {
        points: pts, fill: 'none',
        stroke: 'rgba(96,165,250,0.55)', 'stroke-width': '1.2',
        'stroke-linejoin': 'round',
      }));
    }

    // Zoom window rect
    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const winX = startFrac * MM_W;
    const winW = (endFrac - startFrac) * MM_W;
    winEl.setAttribute('x', winX.toFixed(1));
    winEl.setAttribute('width', winW.toFixed(1));
    winEl.setAttribute('height', MM_H);
  },

  // ─── Minimap drag interaction ────────────────────────────────────────────────

  _onMinimapDrag(e, minimapSvg) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const startX   = e.clientX;
    const startZoom = { ...ChartStore.zoomWindow };

    const onMove = ev => {
      const rect    = minimapSvg.getBoundingClientRect();
      const dx      = (ev.clientX - startX) / rect.width;
      const range   = startZoom.endFrac - startZoom.startFrac;
      ChartStore.setZoom(
        startZoom.startFrac + dx,
        startZoom.startFrac + dx + range,
      );
      this._renderAllCharts();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  },

  // ─── Time window helper ──────────────────────────────────────────────────────

  /**
   * Sets zoom to show only the last `windowMs` milliseconds.
   * Uses the first visible sensor's history to compute the fraction.
   */
  _setTimeWindow(windowMs) {
    const first = ChartStore.activeSeries.find(s => s.visible);
    if (!first) return;

    const history = SensorState.getHistory(first.sensorId);
    if (history.length < 2) return;

    const nowTs    = history[history.length - 1].timestamp;
    const targetTs = nowTs - windowMs;
    // Binary search / linear scan for start index
    let startIdx = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].timestamp <= targetTs) { startIdx = i; break; }
    }

    const startFrac = startIdx / history.length;
    ChartStore.setZoom(Math.max(0, startFrac), 1);
  },

  _renderYLabels(svgEl, yMin, yMax, scaleY, config) {
    const g = svgEl.querySelector('.mc-y-labels');
    if (!g) return;
    g.innerHTML = '';
    for (let i = 0; i <= 3; i++) {
      const v  = yMin + (i / 3) * (yMax - yMin);
      const el = svg('text', {
        x: PAD.left - 3, y: scaleY(v) + 3,
        'text-anchor': 'end', 'font-size': '7.5', fill: '#52565f',
        'font-family': 'JetBrains Mono, monospace',
      });
      el.textContent = this._fmt(v, config);
      g.appendChild(el);
    }
  },

  _renderXLabels(svgEl, history, scaleX) {
    const g = svgEl.querySelector('.mc-x-labels');
    if (!g) return;
    g.innerHTML = '';
    if (history.length < 2) return;

    [0, Math.floor(history.length / 2), history.length - 1].forEach(i => {
      const ts  = history[i]?.timestamp;
      if (!ts) return;
      const ago = Math.floor((Date.now() - ts) / 1000);
      const lbl = ago < 5 ? 'now' : ago < 60 ? `${ago}s` : `${Math.floor(ago/60)}m`;
      const el  = svg('text', {
        x: scaleX(i), y: CH - 3,
        'text-anchor': 'middle', 'font-size': '7.5', fill: '#52565f',
        'font-family': 'JetBrains Mono, monospace',
      });
      el.textContent = lbl;
      g.appendChild(el);
    });
  },

  // ─── Analytics sidebar ───────────────────────────────────────────────────────

  _renderAnalytics() {
    this._renderStatsPanel();
    this._renderComparePanel();
    this._renderCorrelationPanel();
    this._renderEconomicCorrelation();
    this._updateEconomicButtons();
  },

  _renderStatsPanel() {
    const body = document.getElementById('mc-analytics-body');
    if (!body) return;

    const rows = ChartStore.activeSeries
      .filter(s => s.visible)
      .map(({ sensorId }) => {
        const config  = SENSORS.find(s => s.id === sensorId);
        if (!config) return '';

        const { startFrac, endFrac } = ChartStore.zoomWindow;
        const history   = SensorState.getHistory(sensorId);
        const startIdx  = Math.floor(history.length * startFrac);
        const endIdx    = Math.ceil(history.length * endFrac);
        const visible   = history.slice(startIdx, endIdx);
        const values    = visible.map(h => h.value).filter(v => isFinite(v));
        const stats     = computeStats(values);
        const trend     = computeTrend(visible.filter(h => typeof h.value === 'number'));

        if (!stats) return `
          <div class="mc-analytics-row mc-analytics-empty">
            <span class="mc-anal-name">${config.label}</span>
            <span class="mc-anal-hint">No data</span>
          </div>
        `;

        const trendArrow = { rising: '↗', falling: '↘', stable: '→' }[trend?.direction ?? 'stable'];
        const trendColor = trend?.direction === 'rising' ? 'var(--amber)' :
                           trend?.direction === 'falling' ? 'var(--blue)' : 'var(--text2)';

        return `
          <div class="mc-analytics-row">
            <div class="mc-anal-header">
              <span class="mc-anal-name">${config.label}</span>
              <span class="mc-anal-trend" style="color:${trendColor}">${trendArrow}</span>
            </div>
            <div class="mc-anal-grid">
              <span class="mc-anal-key">μ</span><span class="mc-anal-val">${this._fmt(stats.mean, config)}</span>
              <span class="mc-anal-key">σ</span><span class="mc-anal-val">${this._fmt(stats.std, config)}</span>
              <span class="mc-anal-key">min</span><span class="mc-anal-val">${this._fmt(stats.min, config)}</span>
              <span class="mc-anal-key">max</span><span class="mc-anal-val">${this._fmt(stats.max, config)}</span>
              <span class="mc-anal-key">p95</span><span class="mc-anal-val">${this._fmt(stats.p95, config)}</span>
              <span class="mc-anal-key">n</span><span class="mc-anal-val">${stats.n}</span>
            </div>
          </div>
        `;
      });

    body.innerHTML = rows.join('') || '<span class="mc-empty-hint">No sensors active</span>';
  },

  /**
   * Before/After comparison: splits the visible window at its midpoint and
   * compares first-half stats vs second-half stats using compareWindows().
   * Only shown when zoom shows < 95% of total history (i.e. user zoomed in).
   */
  _renderComparePanel() {
    const section = document.getElementById('mc-compare-section');
    const body    = document.getElementById('mc-compare-body');
    if (!section || !body) return;

    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const windowSpan = endFrac - startFrac;

    // Only useful when zoomed in to ≥10% range
    if (windowSpan > 0.95 || windowSpan < 0.05) {
      section.style.display = 'none';
      return;
    }

    const visible = ChartStore.activeSeries.filter(s => s.visible);
    if (visible.length === 0) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    const midFrac = startFrac + windowSpan / 2;

    const rows = visible.map(({ sensorId }) => {
      const config  = SENSORS.find(s => s.id === sensorId);
      if (!config) return '';

      const history  = SensorState.getHistory(sensorId);
      const s1 = Math.floor(history.length * startFrac);
      const s2 = Math.floor(history.length * midFrac);
      const s3 = Math.ceil(history.length * endFrac);

      const beforeVals = history.slice(s1, s2).map(h => h.value).filter(v => isFinite(v));
      const afterVals  = history.slice(s2, s3).map(h => h.value).filter(v => isFinite(v));

      if (beforeVals.length < 2 || afterVals.length < 2) return '';

      const cmp = compareWindows(beforeVals, afterVals);
      if (!cmp) return '';

      const sign    = cmp.meanDelta >= 0 ? '+' : '';
      const pct     = (cmp.meanDeltaRel * 100).toFixed(1);
      const absDelta = this._fmt(Math.abs(cmp.meanDelta), config);
      const sigColor = cmp.significant ? (cmp.meanDelta > 0 ? 'var(--amber)' : 'var(--blue)') : 'var(--text2)';
      const sigLabel = cmp.significant ? (cmp.meanDelta > 0 ? '↑ rising' : '↓ falling') : '→ stable';

      return `
        <div class="mc-cmp-row">
          <div class="mc-cmp-name">${config.label}</div>
          <div class="mc-cmp-delta" style="color:${sigColor}">
            ${sign}${absDelta} ${config.unit}
            <span class="mc-cmp-pct">${sign}${pct}%</span>
          </div>
          <div class="mc-cmp-verdict" style="color:${sigColor}">${sigLabel}</div>
        </div>
      `;
    }).filter(Boolean);

    if (rows.length === 0) {
      section.style.display = 'none';
      return;
    }

    const pct = Math.round(windowSpan * 100);
    body.innerHTML = `
      <div class="mc-cmp-hint">First half vs second half of zoomed window (${pct}% of history)</div>
      ${rows.join('')}
    `;
  },

  _renderCorrelationPanel() {
    const section = document.getElementById('mc-correlation-section');
    const body    = document.getElementById('mc-correlation-body');
    if (!section || !body) return;

    const visible = ChartStore.activeSeries.filter(s => s.visible);
    if (visible.length < 2) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    // Build value arrays aligned to the zoom window
    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const seriesMap = new Map();

    visible.forEach(({ sensorId }) => {
      const history  = SensorState.getHistory(sensorId);
      const startIdx = Math.floor(history.length * startFrac);
      const endIdx   = Math.ceil(history.length * endFrac);
      const vals     = history.slice(startIdx, endIdx).map(h => h.value).filter(v => isFinite(v));
      if (vals.length >= 3) seriesMap.set(sensorId, vals);
    });

    if (seriesMap.size < 2) { section.style.display = 'none'; return; }

    const matrix = computeCorrelationMatrix(seriesMap);
    const ids    = [...seriesMap.keys()];

    // Render a compact list of pairs (skip self-correlations, skip duplicates)
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const r    = matrix.get(ids[i])?.get(ids[j]);
        const desc = describeCorrelation(r);
        const nameA = SENSORS.find(s => s.id === ids[i])?.label ?? ids[i];
        const nameB = SENSORS.find(s => s.id === ids[j])?.label ?? ids[j];
        const abs   = r !== null ? Math.abs(r) : 0;
        const color = abs >= 0.8 ? (r > 0 ? '#22c55e' : '#ef4444') :
                      abs >= 0.5 ? (r > 0 ? '#86efac' : '#fca5a5') : '#52565f';

        pairs.push(`
          <div class="mc-corr-row">
            <div class="mc-corr-names">
              <span>${nameA}</span>
              <span class="mc-corr-sep">↔</span>
              <span>${nameB}</span>
            </div>
            <div class="mc-corr-val" style="color:${color}">
              ${r !== null ? r.toFixed(2) : '—'}
              <span class="mc-corr-label">${desc.label}</span>
            </div>
          </div>
        `);
      }
    }

    body.innerHTML = pairs.join('');
  },

  // ─── Economic cost line overlay ───────────────────────────────────────────────

  _renderEconomicCostLine(svgEl, history, scaleX) {
    const costGroup = svgEl.querySelector('.mc-cost-line');
    const costAxis  = svgEl.querySelector('.mc-cost-axis');
    if (!costGroup || !costAxis) return;

    costGroup.innerHTML = '';
    costAxis.innerHTML  = '';

    const cfg = FinancialConfig.get();
    // Build cumulative cost series
    let accumulated = 0;
    const series = [];
    for (let i = 0; i < history.length; i++) {
      const v = history[i].value;
      if (typeof v === 'number' && isFinite(v) && v > 0) {
        const cost = computeCostPerUnit(v, cfg);
        if (cost) accumulated += cost.totalCostPerHour * (0.5 / 3600);
      }
      series.push(accumulated);
    }

    const maxCost = Math.max(...series, 0.0001);
    const scaleY2 = v => PAD.top + (1 - v / maxCost) * ICH;

    // Draw dashed line
    const pts = series.map((c, i) => {
      const x = scaleX(i).toFixed(1);
      const y = scaleY2(c).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    });

    if (pts.length >= 2) {
      costGroup.appendChild(svg('path', {
        d: pts.join(' '), fill: 'none',
        stroke: 'rgba(251,191,36,0.65)',
        'stroke-width': '1.2', 'stroke-dasharray': '4,3',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }

    // Secondary Y axis (right side)
    const axisX = CW - PAD.right + 2;
    for (let i = 0; i <= 2; i++) {
      const v   = (i / 2) * maxCost;
      const y   = scaleY2(v);
      const lbl = costAxis.appendChild(svg('text', {
        x: axisX + 1, y: y + 3,
        'text-anchor': 'start', 'font-size': '6.5', fill: 'rgba(251,191,36,0.7)',
        'font-family': 'JetBrains Mono, monospace',
      }));
      lbl.textContent = `€${v.toFixed(3)}`;
    }
  },

  // ─── Economic correlation sidebar ─────────────────────────────────────────────

  _renderEconomicCorrelation() {
    const section = document.getElementById('mc-econ-corr-section');
    const body    = document.getElementById('mc-econ-corr-body');
    if (!section || !body) return;

    const show = ChartStore.config.showEconomicCorrelation
      && FinancialConfig.get().economicImpact.enabled;

    const visible = ChartStore.activeSeries.filter(s => s.visible);
    if (!show || visible.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const cfg = FinancialConfig.get();
    const rows = [];

    visible.forEach(({ sensorId }) => {
      const sConfig  = SENSORS.find(s => s.id === sensorId);
      if (!sConfig) return;

      const history  = SensorState.getHistory(sensorId);
      const startIdx = Math.floor(history.length * startFrac);
      const endIdx   = Math.ceil(history.length * endFrac);
      const window   = history.slice(startIdx, endIdx);
      if (window.length < 3) return;

      const sensorVals = window.map(h => h.value).filter(v => isFinite(v));
      const impactVals = window.map(h => {
        const ei = computeEconomicImpact(h.value, sConfig, cfg);
        return ei ? ei.impact2h : 0;
      });

      const r    = computeCorrelation(sensorVals, impactVals);
      const desc = describeCorrelation(r);
      const abs  = r !== null ? Math.abs(r) : 0;
      const color = abs < 0.3 ? 'var(--green)' : abs < 0.7 ? 'var(--amber)' : 'var(--red)';

      rows.push(`
        <div class="mc-corr-row">
          <div class="mc-corr-names">
            <span>${sConfig.label}</span>
            <span class="mc-corr-sep">↔</span>
            <span>€ impact</span>
          </div>
          <div class="mc-corr-val" style="color:${color}">
            ${r !== null ? r.toFixed(2) : '—'}
            <span class="mc-corr-label">${desc.label}</span>
          </div>
        </div>
      `);
    });

    body.innerHTML = rows.join('') || '<span class="mc-empty-hint">No data</span>';
  },

  // ─── Combined economic impact chart ───────────────────────────────────────────

  _renderEconomicImpactChart() {
    const wrap = document.getElementById('mc-economic-chart-wrap');
    if (!wrap) return;

    const visible = ChartStore.getVisibleSeries();
    const show    = ChartStore.config.showEconomicImpact
      && FinancialConfig.get().economicImpact.enabled
      && visible.length >= 2;

    wrap.style.display = show ? '' : 'none';
    if (!show) return;

    const ECON_CH = 80;
    const ECON_ICH = ECON_CH - PAD.top - PAD.bottom;

    const svgEl = document.getElementById('mc-econ-svg');
    if (!svgEl) return;

    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const cfg = FinancialConfig.get();

    // Merge all active sensor histories by index
    const histories = visible.map(({ sensorId }) => {
      const full = SensorState.getHistory(sensorId);
      const s = Math.floor(full.length * startFrac);
      const e = Math.ceil(full.length * endFrac);
      return { sensorId, window: full.slice(s, e) };
    });

    const minLen = Math.min(...histories.map(h => h.window.length));
    if (minLen < 2) return;

    // Combined impact2h at each tick
    const combined = [];
    for (let i = 0; i < minLen; i++) {
      let total = 0;
      histories.forEach(({ sensorId, window }) => {
        const sConfig = SENSORS.find(s => s.id === sensorId);
        if (!sConfig) return;
        const pt = window[i];
        if (!pt || typeof pt.value !== 'number') return;
        const ei = computeEconomicImpact(pt.value, sConfig, cfg);
        if (ei && !ei.inRange) total += ei.impact2h;
      });
      combined.push(total);
    }

    const maxVal = Math.max(...combined, 0.001);
    const scaleX = i  => PAD.left + (i / Math.max(1, minLen - 1)) * ICW;
    const scaleY = v  => PAD.top  + (1 - v / maxVal) * ECON_ICH;
    const baseY  = scaleY(0);

    // Zone bands
    const zonesG = document.getElementById('mc-econ-zones');
    if (zonesG) {
      zonesG.innerHTML = '';
      const thresholds = [
        { lo: 0,  hi: Math.min(10,  maxVal), fill: 'rgba(34,197,94,0.07)' },
        { lo: 10, hi: Math.min(50,  maxVal), fill: 'rgba(245,158,11,0.07)' },
        { lo: 50, hi: maxVal,                fill: 'rgba(239,68,68,0.08)' },
      ];
      thresholds.forEach(({ lo, hi, fill }) => {
        if (lo >= hi || lo >= maxVal) return;
        const y1 = scaleY(hi), ht = scaleY(lo) - y1;
        if (ht < 0.5) return;
        zonesG.appendChild(svg('rect', { x: PAD.left, y: y1, width: ICW, height: ht, fill }));
      });
    }

    // Area + line
    const areasG = document.getElementById('mc-econ-areas');
    const lineG  = document.getElementById('mc-econ-line');
    if (areasG && lineG) {
      areasG.innerHTML = '';
      lineG.innerHTML  = '';

      const dLine = combined
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`)
        .join(' ');

      if (combined.length >= 2) {
        const first = combined[0], last = combined[combined.length - 1];
        areasG.appendChild(svg('path', {
          d: `${dLine} L${scaleX(minLen - 1).toFixed(1)},${baseY.toFixed(1)} L${scaleX(0).toFixed(1)},${baseY.toFixed(1)} Z`,
          fill: 'rgba(245,158,11,0.10)',
        }));
        lineG.appendChild(svg('path', {
          d: dLine, fill: 'none', stroke: '#f59e0b',
          'stroke-width': '1.4', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }));
      }
    }

    // Y labels
    const ylabG = document.getElementById('mc-econ-ylabels');
    if (ylabG) {
      ylabG.innerHTML = '';
      [0, maxVal / 2, maxVal].forEach(v => {
        const el = ylabG.appendChild(svg('text', {
          x: PAD.left - 3, y: scaleY(v) + 3,
          'text-anchor': 'end', 'font-size': '7', fill: '#52565f',
          'font-family': 'JetBrains Mono, monospace',
        }));
        el.textContent = `€${v.toFixed(1)}`;
      });
    }

    // Crosshair sync
    const hf = ChartStore.hoverFrac;
    const xhair = document.getElementById('mc-econ-xhair');
    if (xhair) {
      if (hf !== null && hf !== undefined) {
        const cx = (PAD.left + hf * ICW).toFixed(1);
        xhair.setAttribute('x1', cx); xhair.setAttribute('x2', cx);
        xhair.removeAttribute('display');
      } else {
        xhair.setAttribute('display', 'none');
      }
    }

    // Event markers
    const firstSeries = histories[0]?.window;
    if (firstSeries && firstSeries.length >= 2) {
      const eventsG = document.getElementById('mc-econ-events');
      if (eventsG) {
        eventsG.innerHTML = '';
        const startTs = firstSeries[0].timestamp;
        const endTs   = firstSeries[firstSeries.length - 1].timestamp;
        const range   = endTs - startTs || 1;
        EventMarkers.getInRange(startTs, endTs).forEach(marker => {
          const frac = (marker.timestamp - startTs) / range;
          const x    = (PAD.left + frac * ICW).toFixed(1);
          const col  = marker.severity === 'danger' ? '#ef4444' : '#f59e0b';
          eventsG.appendChild(svg('line', {
            x1: x, y1: PAD.top, x2: x, y2: ECON_CH - PAD.bottom,
            stroke: col, 'stroke-width': '1', 'stroke-dasharray': '3,3', opacity: '0.7',
          }));
        });
      }
    }
  },

  // ─── Update economic button disabled states ───────────────────────────────────

  _updateEconomicButtons() {
    const costEnabled = FinancialConfig.get().costPerUnit.enabled;
    const btn = document.getElementById('mc-btn-econ-cost');
    if (btn) {
      btn.disabled = !costEnabled;
      btn.title    = costEnabled
        ? 'Accumulated cost overlay'
        : 'Enable Cost per unit in financial config first';
    }
  },

  // ─── Source badge ────────────────────────────────────────────────────────────

  _updateSourceBadge(mode) {
    const badge  = document.getElementById('mc-source-badge');
    if (!badge) return;
    const MAP = {
      simulation: { text: '● Simulation', color: 'var(--amber)' },
      mqtt:       { text: '● MQTT Live',  color: 'var(--green)' },
      none:       { text: '○ No source',  color: 'var(--text2)' },
    };
    const { text, color } = MAP[mode] ?? MAP.none;
    badge.textContent   = text;
    badge.style.color   = color;
  },

  _updateSourceBadgeFromState() {
    // Called during render loop to detect stale state
    const lastTs  = SensorState.lastTimestamp;
    const isStale = lastTs !== null && (Date.now() - lastTs) > STALE_MS;
    const badge   = document.getElementById('mc-source-badge');
    if (badge && isStale) {
      badge.textContent = '⚠ Feed paused';
      badge.style.color = 'var(--amber)';
    }
  },

  // ─── Export ──────────────────────────────────────────────────────────────────

  _exportCSV() {
    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const ids    = ChartStore.activeSeries.filter(s => s.visible).map(s => s.sensorId);
    const cfgs   = ids.map(id => SENSORS.find(s => s.id === id)).filter(Boolean);

    // Merge all histories aligned by timestamp
    const allHistory = SensorState.history;
    const startIdx   = Math.floor(allHistory.length * startFrac);
    const endIdx     = Math.ceil(allHistory.length * endFrac);
    const slice      = allHistory.slice(startIdx, endIdx);

    const header = ['timestamp_ms', 'datetime', ...ids.map(id => {
      const cfg = SENSORS.find(s => s.id === id);
      return `${cfg?.label ?? id} (${cfg?.unit ?? ''})`;
    })].join(',');

    const rows = slice.map(snap => {
      const dt = new Date(snap.timestamp).toISOString();
      const vals = ids.map(id => {
        const v = snap.readings[id];
        return (typeof v === 'number' && isFinite(v)) ? v.toFixed(4) : '';
      });
      return [snap.timestamp, dt, ...vals].join(',');
    });

    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `wtp-export-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  _exportClipboard() {
    const { startFrac, endFrac } = ChartStore.zoomWindow;
    const ids    = ChartStore.activeSeries.filter(s => s.visible).map(s => s.sensorId);
    const allHistory = SensorState.history;
    const startIdx   = Math.floor(allHistory.length * startFrac);
    const endIdx     = Math.ceil(allHistory.length * endFrac);
    const slice      = allHistory.slice(startIdx, endIdx);

    const header = ['timestamp', ...ids].join('\t');
    const rows   = slice.map(snap => {
      const vals = ids.map(id => {
        const v = snap.readings[id];
        return (typeof v === 'number') ? v.toFixed(3) : '';
      });
      return [snap.timestamp, ...vals].join('\t');
    });

    navigator.clipboard.writeText([header, ...rows].join('\n'))
      .then(() => this._showToast('Copied to clipboard'))
      .catch(() => this._showToast('Clipboard write failed', true));
  },

  _exportConfig() {
    const configSnapshot = {
      version:      '1.0',
      exportedAt:   new Date().toISOString(),
      activeSeries: ChartStore.activeSeries,
      zoomWindow:   ChartStore.zoomWindow,
      config:       ChartStore.config,
    };
    const blob = new Blob([JSON.stringify(configSnapshot, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `wtp-chart-config-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * PNG export: serialize all visible chart SVGs to a single canvas and download.
   * Uses XMLSerializer + drawImage on a 2× DPI canvas.
   */
  async _exportPNG() {
    const cards  = [...document.querySelectorAll('.mc-chart-card')];
    if (cards.length === 0) { this._showToast('No charts to export', true); return; }

    const SCALE  = 2;
    const W      = 900;
    const HEADER = 36;   // pixels per card header
    const CHART  = 110;  // pixels per SVG (matches .mc-chart height CSS)
    const MM     = 28;   // minimap height
    const STATS  = 28;   // stats bar
    const GAP    = 8;
    const CARD_H = HEADER + CHART + MM + STATS;
    const TOTAL_H = 48 + cards.length * (CARD_H + GAP);

    const canvas  = document.createElement('canvas');
    canvas.width  = W * SCALE;
    canvas.height = TOTAL_H * SCALE;

    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // Background
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, W, TOTAL_H);

    // Title row
    ctx.fillStyle = '#f0f0f0';
    ctx.font      = '600 13px "IBM Plex Sans", sans-serif';
    ctx.fillText('WTP Digital Twin — Multi-Sensor Analysis', 16, 28);
    ctx.fillStyle = '#52565f';
    ctx.font      = '9px "JetBrains Mono", monospace';
    ctx.fillText(new Date().toISOString(), W - 16 - ctx.measureText(new Date().toISOString()).width, 28);

    const serialize = svgEl => {
      const cloned = svgEl.cloneNode(true);
      // Embed fonts as best-effort via font-face (browsers may substitute)
      const xml = new XMLSerializer().serializeToString(cloned);
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    };

    const loadImg = src => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src     = src;
    });

    let y = 48;
    for (const card of cards) {
      const mainSvg = card.querySelector('.mc-chart');
      const mmSvg   = card.querySelector('.mc-minimap');

      // Card background
      ctx.fillStyle = '#141619';
      ctx.beginPath();
      ctx.roundRect(8, y, W - 16, CARD_H, 6);
      ctx.fill();

      // Card label
      const title = card.querySelector('.mc-card-title')?.textContent ?? '';
      const val   = card.querySelector('[id^="mc-value-"]')?.textContent ?? '';
      ctx.fillStyle = '#c8cdd4';
      ctx.font      = '500 10px "IBM Plex Sans", sans-serif';
      ctx.fillText(title, 20, y + 20);
      ctx.fillStyle = '#22c55e';
      ctx.font      = '600 14px "JetBrains Mono", monospace';
      ctx.fillText(val, W - 20 - ctx.measureText(val).width, y + 20);

      if (mainSvg) {
        try {
          const img = await loadImg(serialize(mainSvg));
          ctx.drawImage(img, 8, y + HEADER, W - 16, CHART);
        } catch (_) { /* skip if SVG serialization fails in some browsers */ }
      }
      if (mmSvg) {
        try {
          const img = await loadImg(serialize(mmSvg));
          ctx.drawImage(img, 8, y + HEADER + CHART, W - 16, MM);
        } catch (_) { /* skip */ }
      }

      y += CARD_H + GAP;
    }

    // Download
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `wtp-charts-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
      a.click();
      URL.revokeObjectURL(url);
      this._showToast('PNG exported');
    }, 'image/png');
  },

  _showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'mc-toast';
    toast.textContent = msg;
    toast.style.background = isError ? 'var(--red-bg)' : 'var(--bg2)';
    toast.style.color      = isError ? 'var(--red)'    : 'var(--text0)';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  },

  // ─── Formatters ──────────────────────────────────────────────────────────────

  _fmt(value, config) {
    if (!config || !isFinite(value)) return '—';
    if (config.rangeMax >= 100) return value.toFixed(1);
    if (config.rangeMax >= 10)  return value.toFixed(2);
    return value.toFixed(3);
  },

  _fmtHigh(value, config) {
    if (!config || !isFinite(value)) return '—';
    if (config.rangeMax >= 100) return value.toFixed(2);
    if (config.rangeMax >= 10)  return value.toFixed(3);
    return value.toFixed(4);
  },

  // ─── CSS injection ────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('mc-styles')) return;
    const style = document.createElement('style');
    style.id = 'mc-styles';
    style.textContent = `
/* ── MultiChartPanel ───────────────────────────────────────────────────── */

#mc-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.65);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity 0.18s ease;
}
#mc-overlay.visible { opacity: 1; pointer-events: auto; }

#mc-panel {
  background: var(--bg1);
  border: 1px solid var(--line2);
  border-radius: 10px;
  width: min(1160px, calc(100vw - 32px));
  height: min(740px, calc(100vh - 48px));
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.55);
  transform: translateY(8px);
  transition: transform 0.18s ease;
}
#mc-overlay.visible #mc-panel { transform: translateY(0); }

/* ── Header ── */
#mc-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px;
  height: 46px;
  background: var(--bg2);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
#mc-header-left { display: flex; align-items: center; gap: 14px; }
#mc-title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 12px; font-weight: 600; color: var(--text0);
  letter-spacing: 0.02em;
}
#mc-source-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; color: var(--text2);
}
#mc-header-right { display: flex; align-items: center; gap: 6px; }

.mc-btn {
  background: var(--bg3); border: 1px solid var(--line2);
  color: var(--text1); cursor: pointer; border-radius: 4px;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 10px;
  padding: 4px 9px; transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.mc-btn:hover { background: var(--bg4, #2a2c30); color: var(--text0); border-color: var(--line3, #444); }
.mc-btn--active { background: var(--blue-bg, rgba(96,165,250,0.12)); color: var(--blue, #60a5fa); border-color: rgba(96,165,250,0.3); }
.mc-btn--close { padding: 4px 8px; }
.mc-btn-group { display: flex; }
.mc-btn-group .mc-btn:first-child { border-radius: 4px 0 0 4px; border-right: none; }
.mc-btn-group .mc-btn:last-child  { border-radius: 0 4px 4px 0; }
.mc-btn-sep { width: 1px; background: var(--line2); margin: 8px 2px; }

/* Dropdown */
.mc-dropdown-wrap { position: relative; }
.mc-dropdown {
  position: absolute; top: calc(100% + 4px); right: 0;
  background: var(--bg2); border: 1px solid var(--line2);
  border-radius: 5px; overflow: hidden; z-index: 10;
  box-shadow: 0 8px 20px rgba(0,0,0,0.35); min-width: 180px;
}
.mc-dropdown-item {
  display: block; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 10px;
  color: var(--text1); padding: 8px 14px;
  transition: background 0.1s, color 0.1s;
}
.mc-dropdown-item:hover { background: var(--bg3); color: var(--text0); }

/* ── Body ── */
#mc-body {
  display: flex; flex: 1; overflow: hidden;
}

/* ── Sidebar ── */
#mc-sidebar {
  width: 200px; flex-shrink: 0;
  background: var(--bg2);
  border-right: 1px solid var(--line);
  overflow-y: auto; overflow-x: hidden;
  scrollbar-width: thin; scrollbar-color: var(--line2) transparent;
}
.mc-sidebar-section { padding: 12px 12px 8px; border-bottom: 1px solid var(--line); }
.mc-sidebar-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8px; font-weight: 600; color: var(--text2);
  letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px;
}
.mc-empty-hint {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--text2); font-style: italic;
}

/* Sensor picker pills */
#mc-sensor-picker { display: flex; flex-direction: column; gap: 3px; }
.mc-sensor-pill {
  text-align: left; background: none;
  border: 1px solid var(--line); color: var(--text2);
  border-radius: 3px; padding: 4px 8px; cursor: pointer;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 9px;
  transition: all 0.12s; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.mc-sensor-pill:hover:not(:disabled) { border-color: var(--blue); color: var(--text0); background: var(--blue-bg, rgba(96,165,250,0.08)); }
.mc-sensor-pill.is-active  { background: var(--blue-bg, rgba(96,165,250,0.12)); color: var(--blue, #60a5fa); border-color: rgba(96,165,250,0.35); }
.mc-sensor-pill:disabled   { opacity: 0.35; cursor: not-allowed; }

/* Series rows */
#mc-series-panel { display: flex; flex-direction: column; gap: 4px; }
.mc-series-row {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 0;
}
.mc-series-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.mc-series-name {
  flex: 1; font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--text1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mc-series-toggle, .mc-series-remove {
  background: none; border: none; cursor: pointer;
  color: var(--text2); font-size: 11px; padding: 0 2px;
  transition: color 0.12s;
}
.mc-series-toggle:hover { color: var(--text0); }
.mc-series-toggle.is-hidden { color: var(--text3, #3a3d44); }
.mc-series-remove:hover { color: var(--red); }

/* Analytics panel */
.mc-analytics-row {
  border-bottom: 1px solid rgba(255,255,255,0.04);
  padding: 6px 0;
}
.mc-analytics-row:last-child { border-bottom: none; }
.mc-anal-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 4px;
}
.mc-anal-name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; font-weight: 500; color: var(--text1);
}
.mc-anal-trend { font-size: 11px; }
.mc-anal-grid {
  display: grid; grid-template-columns: 24px 1fr; gap: 1px 0;
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
}
.mc-anal-key { color: var(--text2); }
.mc-anal-val { color: var(--text0); font-weight: 500; }
.mc-analytics-empty { padding: 4px 0; }
.mc-anal-hint { font-family: 'IBM Plex Sans', sans-serif; font-size: 9px; color: var(--text2); }

/* Correlation panel */
.mc-corr-row { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.mc-corr-row:last-child { border-bottom: none; }
.mc-corr-names {
  display: flex; align-items: center; gap: 3px;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 8px; color: var(--text2);
  flex-wrap: wrap; margin-bottom: 2px;
}
.mc-corr-sep { color: var(--text2); }
.mc-corr-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 600;
}
.mc-corr-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8px; font-weight: 400; margin-left: 4px; opacity: 0.75;
}

/* ── Charts area ── */
#mc-charts-area {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  scrollbar-width: thin; scrollbar-color: var(--line2) transparent;
  padding: 0 4px 16px;
  display: flex; flex-direction: column;
}
#mc-zoom-hint {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8px; color: var(--text2);
  padding: 6px 12px; flex-shrink: 0;
  opacity: 0.7;
}
#mc-charts-container {
  display: flex; flex-direction: column; gap: 8px;
  padding: 0 8px;
}
#mc-no-sensors {
  flex: 1; display: none; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 12px; color: var(--text2);
}
.mc-no-sensors-icon { font-size: 32px; opacity: 0.4; }

/* Chart cards */
.mc-chart-card {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 6px; overflow: hidden;
}
.mc-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 12px; background: var(--bg2); border-bottom: 1px solid var(--line);
}
.mc-card-header-left { display: flex; align-items: center; gap: 6px; }
.mc-card-title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 10px; font-weight: 500; color: var(--text0);
}
.mc-card-unit {
  font-family: 'JetBrains Mono', monospace; font-size: 8px; color: var(--text2);
}
.mc-card-badge { /* inherits from sd-badge */ }
.mc-card-header-right { display: flex; align-items: center; gap: 8px; }
.mc-card-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px; font-weight: 600; color: var(--green);
  transition: color 0.3s;
}
.mc-card-trend {
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
  color: var(--text2); white-space: nowrap;
}
.mc-card-remove {
  background: none; border: none; cursor: pointer;
  color: var(--text2); font-size: 14px; padding: 0 2px; line-height: 1;
  transition: color 0.12s;
}
.mc-card-remove:hover { color: var(--red); }

/* Chart SVG */
.mc-card-chart-wrap { position: relative; }
.mc-chart { width: 100%; height: 110px; display: block; cursor: crosshair; }

/* Crosshair */
.mc-xhair-line {
  stroke: rgba(255,255,255,0.25); stroke-width: 1;
  stroke-dasharray: 3,3; pointer-events: none;
}
.mc-xhair-dot { pointer-events: none; }

/* Tooltip */
.mc-tooltip {
  position: absolute; pointer-events: none;
  background: var(--bg2); border: 1px solid var(--line2);
  border-radius: 5px; padding: 6px 10px; z-index: 5;
  min-width: 100px; box-shadow: 0 6px 18px rgba(0,0,0,0.4);
}
.mc-tt-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; font-weight: 600; line-height: 1.2;
}
.mc-tt-unit { font-size: 9px; opacity: 0.65; font-weight: 400; }
.mc-tt-time {
  font-family: 'IBM Plex Sans', sans-serif; font-size: 8px;
  color: var(--text2); margin-top: 2px;
}
.mc-tt-state {
  font-family: 'JetBrains Mono', monospace; font-size: 8px;
  font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; margin-top: 1px;
}

/* Stats bar */
.mc-card-stats {
  display: flex; gap: 12px; flex-wrap: wrap;
  padding: 5px 12px;
  background: var(--bg1); border-top: 1px solid var(--line);
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
  color: var(--text2);
}
.mc-stat b { color: var(--text0); font-weight: 500; }

/* Toast */
.mc-toast {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  padding: 9px 16px; border-radius: 5px;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 11px;
  border: 1px solid var(--line2); box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  animation: mc-toast-in 0.2s ease, mc-toast-out 0.3s ease 2.5s forwards;
}
@keyframes mc-toast-in  { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: none; } }
@keyframes mc-toast-out { to   { opacity:0; transform: translateY(8px); } }

/* ── Minimap ── */
.mc-minimap-wrap {
  background: var(--bg1);
  border-top: 1px solid var(--line);
  overflow: hidden;
  cursor: ew-resize;
}
.mc-minimap {
  width: 100%; height: 28px; display: block;
}

/* ── Event markers (inside SVG via inline attrs; no extra CSS needed) ── */

/* ── Time window buttons ── */
.mc-tw-btn {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.mc-btn-group .mc-tw-btn:not(:first-child):not(:last-child) {
  border-radius: 0;
  border-right: none;
}

/* ── Economic buttons ── */
.mc-btn:disabled {
  opacity: 0.35; cursor: not-allowed; pointer-events: none;
}
#mc-econ-svg { cursor: crosshair; }

/* ── Before/After comparison panel ── */
.mc-cmp-hint {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8px; color: var(--text2); margin-bottom: 6px;
  font-style: italic;
}
.mc-cmp-row {
  padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
}
.mc-cmp-row:last-child { border-bottom: none; }
.mc-cmp-name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; font-weight: 500; color: var(--text1); margin-bottom: 2px;
}
.mc-cmp-delta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; font-weight: 600;
}
.mc-cmp-pct {
  font-size: 9px; font-weight: 400; opacity: 0.75; margin-left: 4px;
}
.mc-cmp-verdict {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8px; margin-top: 1px;
}
    `;
    document.head.appendChild(style);
  },

  destroy() {
    this.close();
    this._unsubscribers.forEach(off => off());
    this._unsubscribers = [];
    this._eventHandlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
    this._eventHandlers = [];
    ChartStore.clearListeners();
    this._overlay?.remove();
    this._overlay = null;
    document.getElementById('mc-styles')?.remove();
  },
};

export default MultiChartPanel;
