/**
 * EventBus.js — Pub/sub desacoplado entre módulos.
 *
 * Solo para NOTIFICACIONES. El estado vive en SensorState.js.
 *
 * Uso:
 *   import EventBus from './EventBus.js';
 *   import { EVENTS } from './events.js';
 *
 *   EventBus.on(EVENTS.SENSOR_UPDATE, handler);
 *   EventBus.off(EVENTS.SENSOR_UPDATE, handler);  // en destroy()
 *   EventBus.emit(EVENTS.SENSOR_UPDATE, payload);
 *
 * REGLA: Todo módulo que llame a .on() debe llamar a .off() en su destroy().
 * Sin esto, los listeners se acumulan como zombies al reiniciar módulos.
 */

const _listeners = new Map();

const EventBus = {
  /**
   * Suscribe un handler a un evento.
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!_listeners.has(event)) {
      _listeners.set(event, new Set());
    }
    _listeners.get(event).add(handler);
  },

  /**
   * Desuscribe un handler de un evento.
   * Llamar siempre en destroy() de cada módulo.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const handlers = _listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  },

  /**
   * Emite un evento con un payload.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const handlers = _listeners.get(event);
    if (!handlers) return;
    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`EventBus: error en handler de "${event}"`, err);
      }
    });
  },

  /**
   * Limpia todos los listeners. Útil en tests o reinicio completo.
   */
  clear() {
    _listeners.clear();
  },
};

export default EventBus;