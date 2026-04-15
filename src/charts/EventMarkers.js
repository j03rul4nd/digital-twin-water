/**
 * EventMarkers.js — Almacén de eventos temporales para anotación en gráficos.
 *
 * Captura automáticamente:
 *   - RULE_TRIGGERED (active=true) → marca de alerta con severidad
 *   - SCENARIO_CHANGED            → marca de inicio de escenario de incidente
 *
 * Los markers se renderizan en MultiChartPanel como líneas verticales de color
 * en cada gráfico, con una pequeña bandera en la parte superior.
 * Permiten correlacionar visualmente cuándo ocurrió una alerta con el
 * comportamiento de los datos — esencial para análisis post-incidente.
 *
 * Se limpia automáticamente al cambiar fuente de datos (DATA_SOURCE_CLEARING).
 */

import EventBus   from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';

const MAX_EVENTS = 120;

const EventMarkers = {
  /** @type {{ timestamp: number, type: 'alert'|'scenario', severity: string, label: string, sensorIds: string[], id?: string }[]} */
  _events: [],

  /** @type {Function[]} — cleanup handlers */
  _handlers: [],

  init() {
    const onAlert = ({ id, severity, message, timestamp, active, sensorIds }) => {
      if (!active) return;
      this._push({
        timestamp,
        type:      'alert',
        severity:  severity ?? 'warning',
        label:     message  ?? id,
        sensorIds: sensorIds ?? [],
        id,
      });
    };

    const onScenario = scenario => {
      if (!scenario) return;
      this._push({
        timestamp: Date.now(),
        type:      'scenario',
        severity:  scenario.severity ?? 'warning',
        label:     `Scenario: ${(scenario.name ?? '').replace(/_/g, ' ')}`,
        sensorIds: [],
      });
    };

    const onClearing = () => this.clear();

    EventBus.on(EVENTS.RULE_TRIGGERED,       onAlert);
    EventBus.on(EVENTS.SCENARIO_CHANGED,     onScenario);
    EventBus.on(EVENTS.DATA_SOURCE_CLEARING, onClearing);

    this._handlers = [
      [EVENTS.RULE_TRIGGERED,       onAlert],
      [EVENTS.SCENARIO_CHANGED,     onScenario],
      [EVENTS.DATA_SOURCE_CLEARING, onClearing],
    ];
  },

  _push(event) {
    this._events.push(event);
    if (this._events.length > MAX_EVENTS) this._events.shift();
  },

  /**
   * Returns all markers whose timestamp falls within [startTs, endTs].
   * @param {number} startTs
   * @param {number} endTs
   * @returns {EventMarkers._events}
   */
  getInRange(startTs, endTs) {
    return this._events.filter(e => e.timestamp >= startTs && e.timestamp <= endTs);
  },

  /**
   * Returns the total number of stored markers.
   */
  count() {
    return this._events.length;
  },

  clear() {
    this._events = [];
  },

  destroy() {
    this._handlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
    this._handlers = [];
    this._events   = [];
  },
};

export default EventMarkers;
