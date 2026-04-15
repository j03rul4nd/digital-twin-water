/**
 * SensorDetailModal.js — Modal de detalle de sensor con gráfico histórico v2.
 *
 * Características:
 *   - Segmentos multicolor: cada tramo se colorea según su zona de estado
 *     (verde=normal, ámbar=warning, rojo=danger) — estilo Grafana
 *   - Bandas de zona en el fondo del gráfico para contexto visual inmediato
 *   - Crosshair + tooltip en hover: valor exacto, timestamp relativo, estado
 *   - Detección de feed pausado: banner animado + chart dimmed cuando
 *     no llegan datos en más de 2.5 ticks (>2500ms)
 *   - Tabla histórica colapsable (<details>) con últimas 60 muestras,
 *     alta precisión de decimales, color-coded por estado
 *
 * Sin dependencias externas — SVG puro + CSS inyectado en <head>.
 */

import EventBus          from '../core/EventBus.js';
import { EVENTS }        from '../core/events.js';
import SensorState       from '../sensors/SensorState.js';
import { SENSORS }       from '../sensors/SensorConfig.js';
import { getSensorState } from '../scene/ColorMapper.js';

// ─── Chart geometry ───────────────────────────────────────────────────────────
const W   = 420;
const H   = 160;
const PAD = { top: 14, right: 12, bottom: 28, left: 46 };
const CW  = W - PAD.left - PAD.right;   // 362 — chart inner width
const CH  = H - PAD.top  - PAD.bottom;  // 118 — chart inner height

// Feed is stale after 2.5 ticks at 500ms resolution
const STALE_MS = 2500;

// ─── Color palette (matching design tokens) ───────────────────────────────────
const COL = {
  normal:  { line: '#22c55e', area: 'rgba(34,197,94,0.10)',   band: 'rgba(34,197,94,0.06)'   },
  warning: { line: '#f59e0b', area: 'rgba(245,158,11,0.10)',  band: 'rgba(245,158,11,0.07)'  },
  danger:  { line: '#ef4444', area: 'rgba(239,68,68,0.10)',   band: 'rgba(239,68,68,0.08)'   },
};

// ─── SVG helper ───────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// ─── Modal singleton ──────────────────────────────────────────────────────────

const SensorDetailModal = {
  _overlay:      null,
  _activeSensor: null,   // { id, config }
  _updateTimer:  null,
  _hoverData:    null,   // { history, scaleX, scaleY, sensorId } — set each render

  init() {
    this._build();
    this._injectStyles();
  },

  open(sensorId) {
    const config = SENSORS.find(s => s.id === sensorId);
    if (!config) return;

    this._activeSensor = { id: sensorId, config };

    document.getElementById('sd-sensor-name').textContent  = config.label;
    document.getElementById('sd-sensor-unit').textContent  = config.unit;
    document.getElementById('sd-current-unit').textContent = config.unit;

    this._hoverData = null;
    this._hideCrosshair();
    this._hideTooltip();
    this._render();

    this._overlay.classList.add('visible');
    this._updateTimer = setInterval(() => this._render(), 500);
  },

  close() {
    this._overlay?.classList.remove('visible');
    if (this._updateTimer) { clearInterval(this._updateTimer); this._updateTimer = null; }
    this._activeSensor = null;
    this._hoverData    = null;
    this._hideCrosshair();
    this._hideTooltip();
  },

  _isOpen() {
    return this._overlay?.classList.contains('visible') ?? false;
  },

  // ─── Build DOM ────────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'sensor-detail-overlay';
    el.innerHTML = `
      <div id="sensor-detail-modal" role="dialog" aria-modal="true">

        <div id="sd-header">
          <div id="sd-header-left">
            <span id="sd-sensor-name">—</span>
            <span id="sd-sensor-unit" class="sd-unit"></span>
            <span id="sd-state-badge" class="sd-badge"></span>
          </div>
          <div id="sd-header-right">
            <button id="sd-compare-btn" title="Open in Multi-Sensor Analysis">⊞ Compare</button>
            <button id="sd-close" aria-label="Close">✕</button>
          </div>
        </div>

        <div id="sd-value-row">
          <span id="sd-current-value" class="sd-big-value">—</span>
          <span id="sd-current-unit" class="sd-big-unit"></span>
          <div id="sd-stale-banner" style="display:none">
            <span aria-hidden="true">⚠</span>
            <span id="sd-stale-msg">Feed paused</span>
          </div>
        </div>

        <div id="sd-chart-wrap">
          <svg id="sd-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
               xmlns="${NS}" aria-hidden="true">
            <defs>
              <clipPath id="sd-clip">
                <rect x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}"/>
              </clipPath>
            </defs>
            <!-- Zone background bands -->
            <g id="sd-zones" clip-path="url(#sd-clip)"></g>
            <!-- Threshold reference lines -->
            <g id="sd-ref-lines" clip-path="url(#sd-clip)"></g>
            <!-- Colored area fills per state segment -->
            <g id="sd-areas" clip-path="url(#sd-clip)"></g>
            <!-- Colored line segments per state -->
            <g id="sd-lines" clip-path="url(#sd-clip)"></g>
            <!-- Y-axis labels -->
            <g id="sd-y-labels"></g>
            <!-- X-axis labels -->
            <g id="sd-x-labels"></g>
            <!-- Crosshair (rendered above everything) -->
            <line id="sd-xhair-line"
                  x1="0" y1="${PAD.top}" x2="0" y2="${H - PAD.bottom}"
                  display="none" clip-path="url(#sd-clip)"/>
            <circle id="sd-xhair-dot" r="3.5" cx="0" cy="0"
                    display="none" stroke-width="1.5"/>
            <!-- Transparent hover capture (must be last to receive events) -->
            <rect id="sd-hover-rect"
                  x="${PAD.left}" y="${PAD.top}"
                  width="${CW}" height="${CH}"
                  fill="transparent" style="cursor:crosshair"/>
          </svg>

          <!-- Absolute-positioned tooltip -->
          <div id="sd-tooltip" class="sd-tooltip" style="display:none"></div>
          <!-- "Collecting data" placeholder -->
          <div id="sd-no-data">Collecting data…</div>
          <!-- Stale overlay dims the chart area -->
          <div id="sd-stale-overlay" style="display:none" aria-hidden="true"></div>
        </div>

        <div id="sd-stats">
          <div class="sd-stat">
            <span class="sd-stat-label">Min</span>
            <span class="sd-stat-value" id="sd-stat-min">—</span>
          </div>
          <div class="sd-stat">
            <span class="sd-stat-label">Avg</span>
            <span class="sd-stat-value" id="sd-stat-avg">—</span>
          </div>
          <div class="sd-stat">
            <span class="sd-stat-label">Max</span>
            <span class="sd-stat-value" id="sd-stat-max">—</span>
          </div>
          <div class="sd-stat">
            <span class="sd-stat-label">Samples</span>
            <span class="sd-stat-value" id="sd-stat-samples">—</span>
          </div>
        </div>

        <details id="sd-history-details">
          <summary>
            <span>Historical Data</span>
            <span id="sd-history-count" class="sd-history-count"></span>
          </summary>
          <div id="sd-history-table-wrap">
            <table id="sd-history-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Value</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody id="sd-history-tbody"></tbody>
            </table>
          </div>
        </details>

        <div id="sd-footer">
          <span class="sd-hint">Last 3 min · 500ms resolution · Hover chart for details</span>
        </div>

      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    // Close on backdrop click or Escape
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen()) this.close();
    });
    document.getElementById('sd-close').addEventListener('click', () => this.close());

    // "Compare" button → open MultiChartPanel pre-loaded with this sensor
    document.getElementById('sd-compare-btn').addEventListener('click', () => {
      const sensorId = this._activeSensor?.id;
      if (!sensorId) return;
      this.close();
      EventBus.emit(EVENTS.OPEN_MULTI_CHART, { sensorIds: [sensorId] });
    });

    // Render table immediately when <details> is opened (don't wait for next tick)
    document.getElementById('sd-history-details')?.addEventListener('toggle', () => {
      const details = document.getElementById('sd-history-details');
      if (details?.open && this._activeSensor) {
        const { id, config } = this._activeSensor;
        this._renderTable(SensorState.getHistory(id), id, config);
      }
    });

    // Hover on the transparent SVG overlay rect
    const svg       = document.getElementById('sd-chart');
    const hoverRect = document.getElementById('sd-hover-rect');

    hoverRect.addEventListener('mousemove',  (e) => this._onHover(e, svg));
    hoverRect.addEventListener('mouseleave', ()  => { this._hideCrosshair(); this._hideTooltip(); });
  },

  // ─── Hover / crosshair ────────────────────────────────────────────────────────

  _onHover(e, svg) {
    const hd = this._hoverData;
    if (!hd || hd.history.length < 2) return;

    const { history, scaleX, scaleY, sensorId } = hd;

    // Map browser X to SVG X, then to data index
    const rect  = svg.getBoundingClientRect();
    const svgX  = (e.clientX - rect.left) * (W / rect.width);
    const frac  = Math.max(0, Math.min(1, (svgX - PAD.left) / CW));
    const idx   = Math.round(frac * (history.length - 1));
    const point = history[idx];
    if (!point || typeof point.value !== 'number') return;

    const cx    = scaleX(idx);
    const cy    = scaleY(point.value);
    const state = getSensorState(sensorId, point.value);
    const col   = COL[state]?.line ?? '#22c55e';

    // Crosshair vertical line
    const xhairLine = document.getElementById('sd-xhair-line');
    if (xhairLine) {
      xhairLine.setAttribute('x1', cx);
      xhairLine.setAttribute('x2', cx);
      xhairLine.removeAttribute('display');
    }

    // Crosshair dot at data point
    const xhairDot = document.getElementById('sd-xhair-dot');
    if (xhairDot) {
      xhairDot.setAttribute('cx', cx);
      xhairDot.setAttribute('cy', cy);
      xhairDot.setAttribute('fill', col);
      xhairDot.setAttribute('stroke', 'rgba(11,12,14,0.85)');
      xhairDot.removeAttribute('display');
    }

    // Tooltip
    const config = this._activeSensor?.config;
    if (!config) return;

    const val      = this._fmtHigh(point.value, config);
    const ago      = Math.floor((Date.now() - point.timestamp) / 1000);
    const timeStr  = ago < 3 ? 'just now'
      : ago < 60   ? `${ago}s ago`
      : `${Math.floor(ago / 60)}m ${String(ago % 60).padStart(2, '0')}s ago`;
    const stateLbl = { normal: 'Normal', warning: 'Warning', danger: 'Danger' }[state] ?? '—';

    const tooltip = document.getElementById('sd-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `
      <div class="sd-tt-value" style="color:${col}">
        ${val}<span class="sd-tt-unit"> ${config.unit}</span>
      </div>
      <div class="sd-tt-time">${timeStr}</div>
      <div class="sd-tt-state" style="color:${col}">${stateLbl}</div>
    `;

    // Position tooltip relative to chart-wrap, flip left when near right edge
    const wrap     = document.getElementById('sd-chart-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const tipX     = (cx / W) * rect.width + (rect.left - wrapRect.left);
    const tipY     = (cy / H) * rect.height + (rect.top  - wrapRect.top);
    const TIP_W    = 120;

    tooltip.style.left    = `${tipX + TIP_W + 10 > wrapRect.width ? tipX - TIP_W - 8 : tipX + 8}px`;
    tooltip.style.top     = `${Math.max(2, tipY - 40)}px`;
    tooltip.style.display = 'block';
  },

  _hideCrosshair() {
    document.getElementById('sd-xhair-line')?.setAttribute('display', 'none');
    document.getElementById('sd-xhair-dot')?.setAttribute('display', 'none');
  },

  _hideTooltip() {
    const t = document.getElementById('sd-tooltip');
    if (t) t.style.display = 'none';
  },

  // ─── Main render (called every 500ms) ─────────────────────────────────────────

  _render() {
    if (!this._activeSensor) return;
    const { id, config } = this._activeSensor;

    // ── Current value + state badge ────────────────────────────────────────────
    const current = SensorState.get(id);
    if (current !== undefined) {
      const state  = getSensorState(id, current);
      const colVar = { normal: 'var(--green)', warning: 'var(--amber)', danger: 'var(--red)' }[state] ?? 'var(--text1)';

      const valEl = document.getElementById('sd-current-value');
      if (valEl) { valEl.textContent = this._fmt(current, config); valEl.style.color = colVar; }

      const badge = document.getElementById('sd-state-badge');
      if (badge) {
        badge.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        badge.className   = `sd-badge sd-badge--${state}`;
      }
    }

    // ── Stale feed detection ───────────────────────────────────────────────────
    this._updateStaleBanner();

    // ── History ────────────────────────────────────────────────────────────────
    const history = SensorState.getHistory(id);
    const values  = history.map(h => h.value).filter(v => typeof v === 'number' && isFinite(v));

    const noData = document.getElementById('sd-no-data');
    if (values.length < 2) {
      if (noData) noData.style.display = 'flex';
      this._hoverData = null;
      return;
    }
    if (noData) noData.style.display = 'none';

    // ── Stats ──────────────────────────────────────────────────────────────────
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const vAvg = values.reduce((a, b) => a + b, 0) / values.length;

    document.getElementById('sd-stat-min').textContent     = this._fmt(vMin, config);
    document.getElementById('sd-stat-avg').textContent     = this._fmt(vAvg, config);
    document.getElementById('sd-stat-max').textContent     = this._fmt(vMax, config);
    document.getElementById('sd-stat-samples').textContent = values.length;

    // ── Scales ─────────────────────────────────────────────────────────────────
    const yMin   = Math.min(config.rangeMin, vMin);
    const yMax   = Math.max(config.rangeMax, vMax);
    const yRange = yMax - yMin || 1;
    const n      = values.length;

    const scaleX = (i) => PAD.left + (i / Math.max(1, n - 1)) * CW;
    const scaleY = (v) => PAD.top  + (1 - (v - yMin) / yRange) * CH;
    const baseY  = scaleY(yMin);

    // Save state for hover handler
    this._hoverData = { history, values, scaleX, scaleY, sensorId: id };

    // ── Chart layers ───────────────────────────────────────────────────────────
    this._renderZoneBands(config, scaleY, yMin, yMax);
    this._renderRefLines(config, scaleY, yMin, yMax);
    this._renderSegments(history, scaleX, scaleY, baseY, id);
    this._renderYLabels(yMin, yMax, scaleY, config);
    this._renderXLabels(history, scaleX);

    // ── History table (only if open — avoids thrashing hidden DOM) ─────────────
    const details = document.getElementById('sd-history-details');
    if (details?.open) this._renderTable(history, id, config);
  },

  // ─── Stale detection ─────────────────────────────────────────────────────────

  _updateStaleBanner() {
    const lastTs  = SensorState.lastTimestamp;
    const isStale = lastTs !== null && (Date.now() - lastTs) > STALE_MS;

    const banner  = document.getElementById('sd-stale-banner');
    const overlay = document.getElementById('sd-stale-overlay');
    const chart   = document.getElementById('sd-chart');

    if (isStale) {
      const ageSec = Math.floor((Date.now() - lastTs) / 1000);
      const ageStr = ageSec < 60
        ? `${ageSec}s ago`
        : `${Math.floor(ageSec / 60)}m ${String(ageSec % 60).padStart(2, '0')}s ago`;

      const msg = document.getElementById('sd-stale-msg');
      if (msg)     msg.textContent            = `Feed paused · ${ageStr}`;
      if (banner)  banner.style.display       = 'flex';
      if (overlay) overlay.style.display      = 'block';
      if (chart)   chart.classList.add('sd-chart--stale');
    } else {
      if (banner)  banner.style.display       = 'none';
      if (overlay) overlay.style.display      = 'none';
      if (chart)   chart.classList.remove('sd-chart--stale');
    }
  },

  // ─── Zone background bands ────────────────────────────────────────────────────

  _renderZoneBands(config, scaleY, yMin, yMax) {
    const g = document.getElementById('sd-zones');
    if (!g) return;
    g.innerHTML = '';

    const addBand = (vLow, vHigh, fill) => {
      const cLow  = Math.max(yMin, Math.min(yMax, vLow));
      const cHigh = Math.max(yMin, Math.min(yMax, vHigh));
      if (cLow >= cHigh) return;

      // Higher value → smaller SVG Y (top of rect)
      const y1 = scaleY(cHigh);
      const ht = scaleY(cLow) - y1;
      if (ht < 0.5) return;

      g.appendChild(s('rect', { x: PAD.left, y: y1, width: CW, height: ht, fill }));
    };

    // Normal zone: between warning thresholds
    addBand(config.warning.low, config.warning.high, COL.normal.band);

    // Warning zones: between warning and danger thresholds
    addBand(config.danger.low,   config.warning.low,  COL.warning.band);
    addBand(config.warning.high, config.danger.high,  COL.warning.band);

    // Danger zones: outside danger thresholds
    addBand(yMin,               config.danger.low,   COL.danger.band);
    addBand(config.danger.high, yMax,                 COL.danger.band);
  },

  // ─── Threshold reference lines ────────────────────────────────────────────────

  _renderRefLines(config, scaleY, yMin, yMax) {
    const g = document.getElementById('sd-ref-lines');
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
      g.appendChild(s('line', {
        x1: PAD.left, x2: W - PAD.right, y1: y, y2: y,
        stroke, 'stroke-width': '0.75', 'stroke-dasharray': dash, opacity: '0.55',
      }));
    });
  },

  // ─── Multi-color segments (Grafana-style) ────────────────────────────────────

  _renderSegments(history, scaleX, scaleY, baseY, sensorId) {
    const areasG = document.getElementById('sd-areas');
    const linesG = document.getElementById('sd-lines');
    if (!areasG || !linesG) return;
    areasG.innerHTML = '';
    linesG.innerHTML = '';

    // Build runs of consecutive points with the same state.
    // At state boundaries, the transition point is shared between adjacent groups
    // so the line segments connect seamlessly.
    const groups = [];
    let current = null;

    history.forEach((point, i) => {
      if (typeof point.value !== 'number' || !isFinite(point.value)) return;
      const px    = scaleX(i);
      const py    = scaleY(point.value);
      const state = getSensorState(sensorId, point.value);

      if (!current || current.state !== state) {
        if (current) current.pts.push({ x: px, y: py }); // bridge point
        current = { state, pts: [{ x: px, y: py }] };
        groups.push(current);
      } else {
        current.pts.push({ x: px, y: py });
      }
    });

    groups.forEach(({ state, pts }) => {
      if (pts.length < 2) return;
      const col = COL[state] ?? COL.normal;

      const dLine = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');

      // Area: close path back to baseline
      const first = pts[0],  last = pts[pts.length - 1];
      const dArea = `${dLine} L${last.x.toFixed(1)},${baseY.toFixed(1)} L${first.x.toFixed(1)},${baseY.toFixed(1)} Z`;

      areasG.appendChild(s('path', { d: dArea, fill: col.area }));
      linesG.appendChild(s('path', {
        d: dLine, fill: 'none', stroke: col.line,
        'stroke-width': '1.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    });
  },

  // ─── Y-axis labels ───────────────────────────────────────────────────────────

  _renderYLabels(yMin, yMax, scaleY, config) {
    const g = document.getElementById('sd-y-labels');
    if (!g) return;
    g.innerHTML = '';

    for (let i = 0; i <= 4; i++) {
      const v  = yMin + (i / 4) * (yMax - yMin);
      const el = s('text', {
        x: PAD.left - 4, y: scaleY(v) + 3,
        'text-anchor': 'end', 'font-size': '8', fill: '#52565f',
        'font-family': 'JetBrains Mono, monospace',
      });
      el.textContent = this._fmt(v, config);
      g.appendChild(el);
    }
  },

  // ─── X-axis labels ───────────────────────────────────────────────────────────

  _renderXLabels(history, scaleX) {
    const g = document.getElementById('sd-x-labels');
    if (!g) return;
    g.innerHTML = '';
    if (history.length < 2) return;

    [0, Math.floor(history.length / 2), history.length - 1].forEach(i => {
      const ts = history[i]?.timestamp;
      if (!ts) return;
      const ago   = Math.floor((Date.now() - ts) / 1000);
      const label = ago < 5 ? 'now' : ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;
      const el    = s('text', {
        x: scaleX(i), y: H - 4,
        'text-anchor': 'middle', 'font-size': '8', fill: '#52565f',
        'font-family': 'JetBrains Mono, monospace',
      });
      el.textContent = label;
      g.appendChild(el);
    });
  },

  // ─── History table ────────────────────────────────────────────────────────────

  _renderTable(history, sensorId, config) {
    const tbody = document.getElementById('sd-history-tbody');
    const count = document.getElementById('sd-history-count');
    if (!tbody) return;

    // Newest first, max 60 entries
    const rows = [...history].reverse().slice(0, 60)
      .filter(p => typeof p.value === 'number');

    if (count) count.textContent = `${rows.length} entries`;

    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();

    rows.forEach(point => {
      const state    = getSensorState(sensorId, point.value);
      const col      = { normal: '#22c55e', warning: '#f59e0b', danger: '#ef4444' }[state] ?? '#aaa';
      const stateTxt = { normal: 'NORM', warning: 'WARN', danger: 'DANG' }[state] ?? '—';
      const ago      = Math.floor((Date.now() - point.timestamp) / 1000);
      const timeStr  = ago < 3 ? 'now'
        : ago < 60   ? `${ago}s`
        : `${Math.floor(ago / 60)}m ${String(ago % 60).padStart(2, '0')}s`;
      const valStr   = this._fmtHigh(point.value, config);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="sd-td-time">${timeStr}</td>
        <td class="sd-td-value">${valStr}<span class="sd-td-unit"> ${config.unit}</span></td>
        <td class="sd-td-state" style="color:${col}">${stateTxt}</td>
      `;
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  },

  // ─── Formatters ──────────────────────────────────────────────────────────────

  /** Standard precision for chart labels / stats */
  _fmt(value, config) {
    if (config.rangeMax >= 100) return value.toFixed(1);
    if (config.rangeMax >= 10)  return value.toFixed(2);
    return value.toFixed(3);
  },

  /** High precision for tooltip / table */
  _fmtHigh(value, config) {
    if (config.rangeMax >= 100) return value.toFixed(2);
    if (config.rangeMax >= 10)  return value.toFixed(3);
    return value.toFixed(4);
  },

  // ─── CSS injection ────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('sd-v2-styles')) return;
    const style = document.createElement('style');
    style.id = 'sd-v2-styles';
    style.textContent = `
      /* ── SensorDetailModal v2 ─────────────────────────────────────────── */

      #sensor-detail-modal {
        max-height: calc(100vh - 64px);
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--line2) transparent;
      }

      /* Taller chart */
      #sd-chart {
        height: 160px !important;
        cursor: crosshair;
        transition: opacity 0.5s, filter 0.5s;
      }

      #sd-chart.sd-chart--stale {
        opacity: 0.5;
        filter: saturate(0.3);
      }

      /* Value row: allow stale banner to sit next to value */
      #sd-value-row {
        align-items: center !important;
        flex-wrap: wrap;
        gap: 8px !important;
      }

      /* Stale banner (pulsing amber pill) */
      #sd-stale-banner {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 5px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        color: var(--amber);
        background: rgba(245,158,11,0.12);
        border: 1px solid rgba(245,158,11,0.3);
        border-radius: 4px;
        padding: 3px 9px;
        animation: sd-pulse 1.6s ease-in-out infinite;
        white-space: nowrap;
      }

      @keyframes sd-pulse {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.45; }
      }

      /* Stale overlay darkens chart area */
      #sd-stale-overlay {
        position: absolute;
        left: 16px; right: 16px; top: 12px; bottom: 0;
        background: rgba(11,12,14,0.3);
        pointer-events: none;
        border-radius: 3px;
      }

      /* Crosshair */
      #sd-xhair-line {
        stroke: rgba(255,255,255,0.3);
        stroke-width: 1;
        stroke-dasharray: 3,3;
        pointer-events: none;
      }

      #sd-xhair-dot {
        pointer-events: none;
      }

      /* Tooltip */
      .sd-tooltip {
        position: absolute;
        pointer-events: none;
        background: var(--bg2);
        border: 1px solid var(--line2);
        border-radius: 6px;
        padding: 7px 11px;
        z-index: 10;
        min-width: 110px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.45);
      }

      .sd-tt-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
      }

      .sd-tt-unit {
        font-size: 10px;
        opacity: 0.65;
        font-weight: 400;
      }

      .sd-tt-time {
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 9px;
        color: var(--text2);
        margin-top: 3px;
      }

      .sd-tt-state {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.05em;
        margin-top: 2px;
        text-transform: uppercase;
      }

      /* History collapsible */
      #sd-history-details {
        margin: 10px 16px 0;
        border: 1px solid var(--line);
        border-radius: 4px;
        overflow: hidden;
      }

      #sd-history-details > summary {
        list-style: none;
        display: flex;
        align-items: center;
        gap: 0;
        padding: 7px 12px;
        background: var(--bg2);
        cursor: pointer;
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 10px;
        color: var(--text1);
        user-select: none;
        transition: background 0.15s;
      }

      #sd-history-details > summary::-webkit-details-marker { display: none; }

      #sd-history-details > summary::after {
        content: '▶';
        font-size: 8px;
        color: var(--text2);
        transition: transform 0.2s ease;
        margin-left: auto;
      }

      #sd-history-details[open] > summary::after {
        transform: rotate(90deg);
      }

      #sd-history-details > summary:hover { background: var(--bg3); }

      .sd-history-count {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9px;
        color: var(--text2);
        margin-left: 7px;
      }

      #sd-history-table-wrap {
        max-height: 198px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--line2) transparent;
      }

      #sd-history-table {
        width: 100%;
        border-collapse: collapse;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
      }

      #sd-history-table thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--bg2);
        padding: 5px 12px;
        text-align: left;
        font-size: 8px;
        color: var(--text2);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        border-bottom: 1px solid var(--line);
        font-weight: 500;
        font-family: 'IBM Plex Sans', sans-serif;
      }

      #sd-history-table tbody tr {
        border-bottom: 1px solid rgba(255,255,255,0.03);
        transition: background 0.1s;
      }

      #sd-history-table tbody tr:hover { background: var(--bg2); }

      .sd-td-time {
        padding: 3px 12px;
        color: var(--text2);
        white-space: nowrap;
        font-size: 9px;
        width: 56px;
      }

      .sd-td-value {
        padding: 3px 12px;
        color: var(--text0);
        font-weight: 500;
      }

      .sd-td-unit {
        color: var(--text2);
        font-size: 8px;
        font-weight: 400;
      }

      .sd-td-state {
        padding: 3px 12px;
        font-weight: 700;
        font-size: 9px;
        letter-spacing: 0.05em;
        width: 42px;
      }

      /* Footer separator */
      #sd-footer {
        border-top: 1px solid var(--line);
        margin-top: 10px;
      }
    `;
    document.head.appendChild(style);
  },

  destroy() {
    this.close();
    this._overlay?.remove();
    this._overlay = null;
    document.getElementById('sd-v2-styles')?.remove();
  },
};

export default SensorDetailModal;
