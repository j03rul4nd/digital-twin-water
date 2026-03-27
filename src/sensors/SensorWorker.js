/**
 * SensorWorker.js — Wrapper del Web Worker del simulador.
 *
 * Instancia sensor.worker.js como ES Module Worker y expone
 * una API limpia para main.js: start(), pause(), resume(), stop().
 *
 * El Worker se instancia con { type: 'module' } porque sensor.worker.js
 * usa import de ES Modules (NoiseGenerator.js).
 *
 * main.js usa este wrapper para la transición Worker ↔ MQTTAdapter:
 *   MQTT_CONNECTED    → SensorWorker.pause()
 *   MQTT_ERROR        → SensorWorker.resume()
 *   MQTT_DISCONNECTED → SensorWorker.resume()
 *
 * El Worker puede enviar un tick más después de pause() — es esperado
 * y aceptable. SensorState recibe el mismo objeto sin importar la fuente.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import SensorState from '../sensors/SensorState.js';

const SensorWorker = {
  /** @type {Worker | null} */
  _worker: null,

  /**
   * Instancia el Worker y registra el handler de mensajes.
   * Llamar en el paso 6 (último) de init() en main.js.
   */
  start() {
    if (this._worker) return; // ya iniciado

    this._worker = new Worker(
      new URL('../sensors/sensor.worker.js', import.meta.url),
      { type: 'module' }
    );

    this._worker.addEventListener('message', (event) => {
      const snapshot = event.data;

      // Validación mínima — el Worker siempre envía { timestamp, readings }
      if (!snapshot?.timestamp || !snapshot?.readings) return;

      SensorState.update(snapshot);
      EventBus.emit(EVENTS.SENSOR_UPDATE, snapshot);
    });

    this._worker.addEventListener('error', (err) => {
      console.error('SensorWorker: error en el Worker thread', err);
    });

    // El Worker arranca automáticamente al instanciarse (startLoop() en su init)
    // pero enviamos 'start' explícito para consistencia con el ciclo de vida
    this._worker.postMessage({ cmd: 'start' });
  },

  /**
   * Pausa el simulador.
   * Llamar cuando MQTTAdapter se conecta exitosamente.
   * El Worker puede completar el tick en curso antes de parar — es esperado.
   */
  pause() {
    this._worker?.postMessage({ cmd: 'pause' });
  },

  /**
   * Reanuda el simulador.
   * Llamar cuando MQTTAdapter desconecta o falla.
   */
  resume() {
    this._worker?.postMessage({ cmd: 'resume' });
  },

  /**
   * Detiene el Worker completamente y libera el thread.
   * Llamar al desmontar la app.
   */
  stop() {
    if (this._worker) {
      this._worker.postMessage({ cmd: 'stop' });
      this._worker.terminate();
      this._worker = null;
    }
  },
};

export default SensorWorker;