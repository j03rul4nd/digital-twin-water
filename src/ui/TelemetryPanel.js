/**
 * TelemetryPanel.js — Panel de telemetría izquierdo.
 *
 * Renderiza 10 sensor rows en orden de flujo del proceso.
 * Escucha EVENTS.SENSOR_UPDATE y actualiza solo los atributos
 * que cambian — nunca re-renderiza el row completo.
 *
 * Clic en un sensor row → abre SensorDetailModal con el histórico.
 *
 * Muestra '—' hasta SensorState.isReady() (primeros ~500ms).
 * Activa el badge 'live' en el primer tick.
 */

import EventBus          from '../core/EventBus.js';
import { EVENTS }        from '../core/events.js';
import { SENSORS }       from '../sensors/SensorConfig.js';
import SensorState       from '../sensors/SensorState.js';
import { getSensorState } from '../scene/ColorMapper.js';
import SensorDetailModal from './SensorDetailModal.js';

const STATE_COLOR = {
  normal:  'var(--green)',
  warning: 'var(--amber)',
  danger:  'var(--red)',
  unknown: 'var(--text2)',
};

const TelemetryPanel = {
  _handler: null,
  _isLive:  false,

  init() {
    const body = document.getElementById('telemetry-body');
    if (!body) throw new Error('TelemetryPanel: no se encontró #telemetry-body');

    SENSORS.forEach(sensor => {
      const row = this._createRow(sensor);
      body.appendChild(row);
    });

    this._handler = (snapshot) => this._update(snapshot);
    EventBus.on(EVENTS.SENSOR_UPDATE, this._handler);
  },

  _createRow(sensor) {
    const row = document.createElement('div');
    row.className       = 'sensor-row';
    row.dataset.sensorId = sensor.id;
    row.title           = 'Click to see history';

    row.innerHTML = `
      <div class="sensor-left">
        <div class="sensor-name">${sensor.label}</div>
        <div class="sensor-bar-wrap">
          <div class="sensor-bar-fill" data-bar></div>
        </div>
      </div>
      <div class="sensor-value-wrap">
        <span class="sensor-value" data-value>—</span>
        <span class="sensor-unit">${sensor.unit}</span>
      </div>
      <div class="sensor-chart-icon">↗</div>
    `;

    // Clic abre el modal de detalle
    row.addEventListener('click', () => {
      SensorDetailModal.open(sensor.id);
    });

    return row;
  },

  _update(snapshot) {
    if (!this._isLive) {
      this._isLive = true;
      this._activateLiveBadge();
    }

    const body = document.getElementById('telemetry-body');
    if (!body) return;

    SENSORS.forEach(sensor => {
      const value = snapshot.readings[sensor.id];
      if (value === undefined) return;

      const row = body.querySelector(`[data-sensor-id="${sensor.id}"]`);
      if (!row) return;

      const state = getSensorState(sensor.id, value);
      const color = STATE_COLOR[state] ?? STATE_COLOR.unknown;

      const valueEl = row.querySelector('[data-value]');
      if (valueEl) {
        valueEl.textContent = this._formatValue(value, sensor);
        valueEl.style.color = color;
      }

      const barEl = row.querySelector('[data-bar]');
      if (barEl) {
        barEl.style.width           = `${this._barWidth(sensor, value)}%`;
        barEl.style.backgroundColor = color;
      }

      if (state === 'danger') {
        row.classList.add('is-danger');
      } else {
        row.classList.remove('is-danger');
      }
    });
  },

  _formatValue(value, sensor) {
    if (sensor.rangeMax >= 100) return value.toFixed(1);
    if (sensor.rangeMax >= 10)  return value.toFixed(2);
    return value.toFixed(3);
  },

  _barWidth(sensor, value) {
    const { rangeMin, rangeMax } = sensor;
    return Math.min(100, Math.max(0,
      ((value - rangeMin) / (rangeMax - rangeMin)) * 100
    ));
  },

  _activateLiveBadge() {
    const badge = document.getElementById('live-badge');
    if (badge) badge.classList.add('is-live');
    const dot = badge?.querySelector('.live-dot');
    if (dot) dot.classList.add('pulse');
  },

  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.SENSOR_UPDATE, this._handler);
      this._handler = null;
    }
  },
};

export default TelemetryPanel;