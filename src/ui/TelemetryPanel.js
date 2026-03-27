/**
 * TelemetryPanel.js — Panel de telemetría izquierdo.
 *
 * Renderiza 10 sensor rows en orden de flujo del proceso.
 * Escucha EVENTS.SENSOR_UPDATE y actualiza solo los atributos
 * que cambian — nunca re-renderiza el row completo.
 *
 * Muestra '—' hasta SensorState.isReady() (primeros ~500ms).
 * Activa el badge 'live' en el primer tick.
 *
 * Reutiliza getSensorState() y getColorForState() de ColorMapper
 * para no duplicar la lógica de umbrales.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import { SENSORS } from '../sensors/SensorConfig.js';
import SensorState from '../sensors/SensorState.js';
import { getSensorState, getColorForState } from '../scene/ColorMapper.js';

// Mapa de colores hex a variables CSS — la UI usa variables, no hex
const STATE_COLOR = {
  normal:  'var(--green)',
  warning: 'var(--amber)',
  danger:  'var(--red)',
  unknown: 'var(--text2)',
};

const TelemetryPanel = {
  /** @type {Function} */
  _handler: null,

  /** @type {boolean} — true cuando ha llegado el primer tick */
  _isLive: false,

  /**
   * Construye los rows en el DOM y registra el listener.
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    const body = document.getElementById('telemetry-body');
    if (!body) throw new Error('TelemetryPanel: no se encontró #telemetry-body');

    // Construir los 10 rows según el orden de SENSORS (flujo del proceso)
    SENSORS.forEach(sensor => {
      const row = this._createRow(sensor);
      body.appendChild(row);
    });

    // Suscribir al EventBus
    this._handler = (snapshot) => this._update(snapshot);
    EventBus.on(EVENTS.SENSOR_UPDATE, this._handler);
  },

  /**
   * Crea el elemento DOM de un sensor row en estado inicial (sin datos).
   * @param {{ id, label, unit }} sensor
   * @returns {HTMLElement}
   */
  _createRow(sensor) {
    const row = document.createElement('div');
    row.className = 'sensor-row';
    row.dataset.sensorId = sensor.id;

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
    `;

    return row;
  },

  /**
   * Actualiza todos los rows con el snapshot recibido.
   * Actualiza solo los atributos que cambian — sin reflow completo.
   * @param {{ timestamp: number, readings: Record<string, number> }} snapshot
   */
  _update(snapshot) {
    // Activar badge 'live' en el primer tick
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

      // Valor numérico
      const valueEl = row.querySelector('[data-value]');
      if (valueEl) {
        valueEl.textContent = this._formatValue(value, sensor);
        valueEl.style.color = color;
      }

      // Barra de progreso
      const barEl = row.querySelector('[data-bar]');
      if (barEl) {
        const pct = this._barWidth(sensor, value);
        barEl.style.width = `${pct}%`;
        barEl.style.backgroundColor = color;
      }

      // Fondo del row en danger
      if (state === 'danger') {
        row.classList.add('is-danger');
      } else {
        row.classList.remove('is-danger');
      }
    });
  },

  /**
   * Formatea el valor numérico para mostrar en la UI.
   * Máximo 1 decimal para valores grandes, 2–3 para valores pequeños.
   * @param {number} value
   * @param {{ rangeMax: number }} sensor
   * @returns {string}
   */
  _formatValue(value, sensor) {
    if (sensor.rangeMax >= 100) return value.toFixed(1);
    if (sensor.rangeMax >= 10)  return value.toFixed(2);
    return value.toFixed(3);
  },

  /**
   * Calcula el porcentaje de la barra de progreso.
   * Clampea entre 0 y 100.
   * @param {{ rangeMin: number, rangeMax: number }} sensor
   * @param {number} value
   * @returns {number} 0–100
   */
  _barWidth(sensor, value) {
    const { rangeMin, rangeMax } = sensor;
    return Math.min(100, Math.max(0,
      ((value - rangeMin) / (rangeMax - rangeMin)) * 100
    ));
  },

  /**
   * Activa el badge 'live' del panel header.
   * Dot verde + animación pulse + texto verde.
   */
  _activateLiveBadge() {
    const badge = document.getElementById('live-badge');
    if (badge) badge.classList.add('is-live');

    const dot = badge?.querySelector('.live-dot');
    if (dot) dot.classList.add('pulse');
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.SENSOR_UPDATE, this._handler);
      this._handler = null;
    }
  },
};

export default TelemetryPanel;