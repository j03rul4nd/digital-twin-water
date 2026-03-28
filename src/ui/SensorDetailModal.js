/**
 * SensorDetailModal.js — Modal de detalle de sensor con gráfico histórico.
 *
 * Se abre al hacer clic en cualquier sensor row del panel de telemetría.
 * Muestra los últimos 3 minutos de datos (360 snapshots × 500ms).
 *
 * Gráfico SVG puro — sin librerías externas.
 * Se actualiza en vivo cada 500ms mientras el modal está abierto.
 *
 * Contenido del modal:
 *   - Nombre, valor actual y unidad del sensor
 *   - Gráfico de línea con área rellena
 *   - Líneas de referencia para warning y danger
 *   - Stats: min, max, media del período visible
 *   - Estado actual (Normal / Warning / Danger)
 */

import EventBus          from '../core/EventBus.js';
import { EVENTS }        from '../core/events.js';
import SensorState       from '../sensors/SensorState.js';
import { SENSORS }       from '../sensors/SensorConfig.js';
import { getSensorState } from '../scene/ColorMapper.js';

// Dimensiones del gráfico SVG
const W = 360;
const H = 120;
const PAD = { top: 12, right: 8, bottom: 24, left: 40 };

const SensorDetailModal = {
  _overlay:      null,
  _activeSensor: null,   // { id, config }
  _updateTimer:  null,
  _handler:      null,

  init() {
    this._build();
  },

  /**
   * Abre el modal para un sensor concreto.
   * Llamado por TelemetryPanel al hacer clic en un row.
   * @param {string} sensorId
   */
  open(sensorId) {
    const config = SENSORS.find(s => s.id === sensorId);
    if (!config) return;

    this._activeSensor = { id: sensorId, config };

    // Header
    document.getElementById('sd-sensor-name').textContent = config.label;
    document.getElementById('sd-sensor-unit').textContent = config.unit;

    // Renderizar inmediatamente
    this._render();

    this._overlay.classList.add('visible');

    // Actualizar cada 500ms mientras está abierto
    this._updateTimer = setInterval(() => this._render(), 500);
  },

  close() {
    this._overlay?.classList.remove('visible');
    if (this._updateTimer) { clearInterval(this._updateTimer); this._updateTimer = null; }
    this._activeSensor = null;
  },

  _isOpen() {
    return this._overlay?.classList.contains('visible') ?? false;
  },

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'sensor-detail-overlay';
    el.innerHTML = `
      <div id="sensor-detail-modal" role="dialog">

        <div id="sd-header">
          <div id="sd-header-left">
            <span id="sd-sensor-name">—</span>
            <span id="sd-sensor-unit" class="sd-unit"></span>
            <span id="sd-state-badge" class="sd-badge"></span>
          </div>
          <button id="sd-close" aria-label="Close">✕</button>
        </div>

        <div id="sd-value-row">
          <span id="sd-current-value" class="sd-big-value">—</span>
          <span id="sd-current-unit" class="sd-big-unit"></span>
        </div>

        <div id="sd-chart-wrap">
          <svg id="sd-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
               xmlns="http://www.w3.org/2000/svg">
            <!-- Líneas de referencia -->
            <g id="sd-ref-lines"></g>
            <!-- Área rellena -->
            <path id="sd-area" fill="none"/>
            <!-- Línea principal -->
            <path id="sd-line" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
            <!-- Labels del eje Y -->
            <g id="sd-y-labels"></g>
            <!-- Labels del eje X -->
            <g id="sd-x-labels"></g>
          </svg>
          <div id="sd-no-data">Collecting data…</div>
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

        <div id="sd-footer">
          <span class="sd-hint">Last 3 minutes · 500ms resolution · Click outside to close</span>
        </div>

      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen()) this.close();
    });
    document.getElementById('sd-close').addEventListener('click', () => this.close());
  },

  // ─── Render del gráfico ──────────────────────────────────────────────────────

  _render() {
    if (!this._activeSensor) return;
    const { id, config } = this._activeSensor;

    // Obtener histórico
    const history = SensorState.getHistory(id);
    const values  = history.map(h => h.value).filter(v => typeof v === 'number' && isFinite(v));

    // Valor actual
    const current = SensorState.get(id);
    if (current !== undefined) {
      const state = getSensorState(id, current);
      const color = { normal: 'var(--green)', warning: 'var(--amber)', danger: 'var(--red)' }[state] ?? 'var(--text1)';
      const fmt   = this._fmt(current, config);

      document.getElementById('sd-current-value').textContent = fmt;
      document.getElementById('sd-current-value').style.color = color;
      document.getElementById('sd-current-unit').textContent  = config.unit;

      // Badge de estado
      const badge = document.getElementById('sd-state-badge');
      badge.textContent  = state.charAt(0).toUpperCase() + state.slice(1);
      badge.className    = `sd-badge sd-badge--${state}`;
    }

    // Sin datos
    const noData = document.getElementById('sd-no-data');
    if (values.length < 2) {
      noData.style.display = 'flex';
      return;
    }
    noData.style.display = 'none';

    // Stats
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    document.getElementById('sd-stat-min').textContent     = this._fmt(min, config);
    document.getElementById('sd-stat-avg').textContent     = this._fmt(avg, config);
    document.getElementById('sd-stat-max').textContent     = this._fmt(max, config);
    document.getElementById('sd-stat-samples').textContent = values.length;

    // Rango del gráfico — usar el rango del sensor con padding
    const yMin = Math.min(config.rangeMin, min);
    const yMax = Math.max(config.rangeMax, max);
    const yRange = yMax - yMin || 1;

    // Funciones de escala
    const scaleX = (i) => PAD.left + (i / (values.length - 1)) * (W - PAD.left - PAD.right);
    const scaleY = (v) => PAD.top  + (1 - (v - yMin) / yRange) * (H - PAD.top - PAD.bottom);

    // Líneas de referencia (warning y danger)
    this._renderRefLines(config, scaleY, yMin, yMax);

    // Path de línea
    const linePts = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');

    // Path de área (rellena hacia abajo)
    const firstX = scaleX(0).toFixed(1);
    const lastX  = scaleX(values.length - 1).toFixed(1);
    const baseY  = scaleY(yMin).toFixed(1);
    const areaPts = `${linePts} L${lastX},${baseY} L${firstX},${baseY} Z`;

    // Color según estado actual
    const state     = current !== undefined ? getSensorState(id, current) : 'normal';
    const lineColor = { normal: '#22c55e', warning: '#f59e0b', danger: '#ef4444' }[state] ?? '#22c55e';
    const areaColor = { normal: '#22c55e18', warning: '#f59e0b18', danger: '#ef444418' }[state] ?? '#22c55e18';

    document.getElementById('sd-line').setAttribute('d', linePts);
    document.getElementById('sd-line').setAttribute('stroke', lineColor);
    document.getElementById('sd-area').setAttribute('d', areaPts);
    document.getElementById('sd-area').setAttribute('fill', areaColor);

    // Labels eje Y
    this._renderYLabels(yMin, yMax, scaleY, config);

    // Labels eje X (marcas de tiempo)
    this._renderXLabels(history, scaleX);
  },

  _renderRefLines(config, scaleY, yMin, yMax) {
    const group = document.getElementById('sd-ref-lines');
    if (!group) return;
    group.innerHTML = '';

    const lines = [
      { value: config.warning.low,  color: '#f59e0b', dash: '3,3',   label: 'W' },
      { value: config.warning.high, color: '#f59e0b', dash: '3,3',   label: 'W' },
      { value: config.danger.low,   color: '#ef4444', dash: '2,4',   label: 'D' },
      { value: config.danger.high,  color: '#ef4444', dash: '2,4',   label: 'D' },
    ];

    lines.forEach(({ value, color, dash }) => {
      if (value < yMin || value > yMax) return; // fuera del rango visible
      const y = scaleY(value).toFixed(1);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', PAD.left);
      line.setAttribute('x2', W - PAD.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '0.75');
      line.setAttribute('stroke-dasharray', dash);
      line.setAttribute('opacity', '0.5');
      group.appendChild(line);
    });
  },

  _renderYLabels(yMin, yMax, scaleY, config) {
    const group = document.getElementById('sd-y-labels');
    if (!group) return;
    group.innerHTML = '';

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const value = yMin + (i / steps) * (yMax - yMin);
      const y     = scaleY(value);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', PAD.left - 4);
      text.setAttribute('y', y + 3);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('font-size', '8');
      text.setAttribute('fill', '#52565f');
      text.setAttribute('font-family', 'JetBrains Mono, monospace');
      text.textContent = this._fmt(value, config);
      group.appendChild(text);
    }
  },

  _renderXLabels(history, scaleX) {
    const group = document.getElementById('sd-x-labels');
    if (!group) return;
    group.innerHTML = '';

    if (history.length < 2) return;

    // Solo 3 marcas: inicio, mitad, fin
    const marks = [0, Math.floor(history.length / 2), history.length - 1];
    marks.forEach(i => {
      const ts  = history[i]?.timestamp;
      if (!ts) return;
      const x   = scaleX(i);
      const ago = Math.floor((Date.now() - ts) / 1000);
      const label = ago < 5 ? 'now' : ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', H - 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '8');
      text.setAttribute('fill', '#52565f');
      text.setAttribute('font-family', 'JetBrains Mono, monospace');
      text.textContent = label;
      group.appendChild(text);
    });
  },

  // ─── Formateo ────────────────────────────────────────────────────────────────

  _fmt(value, config) {
    if (config.rangeMax >= 100) return value.toFixed(1);
    if (config.rangeMax >= 10)  return value.toFixed(2);
    return value.toFixed(3);
  },

  destroy() {
    this.close();
    this._overlay?.remove();
    this._overlay = null;
  },
};

export default SensorDetailModal;