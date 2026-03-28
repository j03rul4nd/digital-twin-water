/**
 * SensorWorker.js — Wrapper del Web Worker del simulador.
 *
 * API: start(), pause(), resume(), stop(), scenario(name, durationMs)
 *
 * El Worker puede enviar dos tipos de mensajes:
 *   { timestamp, readings }          — snapshot de sensores (normal)
 *   { type: 'scenario_update', ... } — cambio de estado de escenario
 *
 * Los mensajes de tipo scenario_update se emiten como EVENTS.SCENARIO_CHANGED
 * para que IncidentPanel pueda actualizar su UI sin polling.
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import SensorState from '../sensors/SensorState.js';

const SensorWorker = {
  /** @type {Worker | null} */
  _worker: null,

  start() {
    if (this._worker) return;

    this._worker = new Worker(
      new URL('../sensors/sensor.worker.js', import.meta.url),
      { type: 'module' }
    );

    this._worker.addEventListener('message', (event) => {
      const data = event.data;

      // Mensaje de control de escenario
      if (data?.type === 'scenario_update') {
        EventBus.emit(EVENTS.SCENARIO_CHANGED, data.scenario);
        return;
      }

      // Snapshot de sensores — validación mínima
      if (!data?.timestamp || !data?.readings) return;

      SensorState.update(data);
      EventBus.emit(EVENTS.SENSOR_UPDATE, data);
    });

    this._worker.addEventListener('error', (err) => {
      console.error('SensorWorker: error en el Worker thread', err);
    });

    this._worker.postMessage({ cmd: 'start' });
  },

  pause()  { this._worker?.postMessage({ cmd: 'pause' }); },
  resume() { this._worker?.postMessage({ cmd: 'resume' }); },

  /**
   * Activa un escenario de incidente en el simulador.
   * @param {string} name       — nombre del escenario (o 'reset')
   * @param {number} durationMs — duración (default 30s)
   */
  scenario(name, durationMs = 30_000) {
    this._worker?.postMessage({ cmd: 'scenario', name, durationMs });
  },

  stop() {
    if (this._worker) {
      this._worker.postMessage({ cmd: 'stop' });
      this._worker.terminate();
      this._worker = null;
    }
  },
};

export default SensorWorker;