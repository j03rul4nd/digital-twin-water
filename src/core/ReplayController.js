/**
 * ReplayController.js — Single source of truth for replay mode state.
 *
 * Responsabilidades:
 *   - Activar / desactivar modo replay (enter / exit)
 *   - Posicionar el cursor en un índice del histórico (scrubTo)
 *   - Construir snapshots a partir de SensorState.history y EventMarkers
 *   - Notificar cambios vía EventBus (REPLAY_ENTERED / REPLAY_EXITED /
 *     REPLAY_SCRUBBED) y vía suscripción directa (observable, estilo ChartStore)
 *
 * Patrón observable:
 *   subscribe(fn) → unsubscribe. fn recibe el estado interno en cada cambio.
 *   Mismo patrón que ChartStore y FinancialConfig.
 *
 * Contrato del snapshot:
 *   {
 *     timestamp:       number,                     // ms epoch del frame histórico
 *     readings:        Record<string, number>,     // sensor id → valor en ese frame
 *     index:           number,                     // posición en SensorState.history
 *     activeAlertIds:  string[],                   // alertas activas en ese instante
 *   }
 *
 * Derivación de activeAlertIds:
 *   Se listan/ocultan a partir de EventMarkers.getInRange(0, snapshot.timestamp).
 *   EventMarkers solo captura alertas active:true, por lo que este controller
 *   no intenta reconstruir transiciones active:false — todas las alertas
 *   previas al timestamp del snapshot se consideran activas en replay.
 *   Es una simplificación aceptable: el usuario ve el contexto histórico
 *   de alertas cercanas al frame seleccionado. Para análisis rigurosos de
 *   ciclos activo/resuelto, el AlertPanel mantiene su historia completa.
 *
 * Auto-exit:
 *   Se suscribe a DATA_SOURCE_CLEARING. Si el usuario cambia la fuente de datos
 *   mientras está en replay, salimos limpiamente antes de que se borre el histórico.
 *
 * Edge cases:
 *   - enter() con history vacío: console.warn + no-op
 *   - scrubTo() fuera de rango: clamp a [0, history.length - 1]
 *   - destroy(): cleanup de suscripciones y subscribers
 */

import EventBus   from './EventBus.js';
import { EVENTS } from './events.js';
import SensorState from '../sensors/SensorState.js';
import EventMarkers from '../charts/EventMarkers.js';

const ReplayController = {
  _active:      false,
  _index:       null,       // índice en SensorState.history
  _subscribers: new Set(),  // Set<Function>
  _handlers:    [],         // [[event, handler], …] — cleanup

  init() {
    // Auto-exit cuando se va a limpiar la fuente de datos.
    // Debe ejecutarse ANTES de que SensorState.reset() borre el histórico.
    const onClearing = () => {
      if (this._active) this.exit();
    };
    EventBus.on(EVENTS.DATA_SOURCE_CLEARING, onClearing);
    this._handlers.push([EVENTS.DATA_SOURCE_CLEARING, onClearing]);
  },

  // ─── Estado público ──────────────────────────────────────────────────────────

  isActive() {
    return this._active;
  },

  /**
   * Devuelve el snapshot actual del cursor de replay, o null si no está activo.
   * @returns {{ timestamp, readings, index, activeAlertIds } | null}
   */
  getSnapshot() {
    if (!this._active || this._index === null) return null;
    return this._buildSnapshot(this._index);
  },

  // ─── Entrada / salida ────────────────────────────────────────────────────────

  /**
   * Activa el modo replay y coloca el cursor en el frame más reciente.
   * No-op si el historial está vacío (con warn en consola).
   */
  enter() {
    if (this._active) return;

    const len = SensorState.history.length;
    if (len === 0) {
      console.warn('[ReplayController] cannot enter replay: history is empty');
      return;
    }

    this._active = true;
    this._index  = len - 1; // último frame = más reciente

    const snapshot = this._buildSnapshot(this._index);
    EventBus.emit(EVENTS.REPLAY_ENTERED, { index: this._index, snapshot });
    this._notify();
  },

  /**
   * Sale del modo replay. Los consumidores reanudan el render live
   * al recibir REPLAY_EXITED.
   */
  exit() {
    if (!this._active) return;

    this._active = false;
    this._index  = null;

    EventBus.emit(EVENTS.REPLAY_EXITED);
    this._notify();
  },

  /**
   * Mueve el cursor a un índice del histórico.
   * Clamp automático al rango válido.
   * @param {number} index
   */
  scrubTo(index) {
    if (!this._active) return;

    const len = SensorState.history.length;
    if (len === 0) {
      this.exit();
      return;
    }

    const clamped = Math.max(0, Math.min(len - 1, Math.floor(index)));
    if (clamped === this._index) return;

    this._index = clamped;

    const snapshot = this._buildSnapshot(clamped);
    EventBus.emit(EVENTS.REPLAY_SCRUBBED, { index: clamped, snapshot });
    this._notify();
  },

  // ─── Observable pattern (estilo ChartStore / FinancialConfig) ────────────────

  /**
   * @param {Function} fn — recibe { active, index } en cada cambio
   * @returns {Function} unsubscribe
   */
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  },

  /** @private */
  _notify() {
    const payload = { active: this._active, index: this._index };
    this._subscribers.forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[ReplayController] listener error:', e); }
    });
  },

  // ─── Construcción del snapshot ───────────────────────────────────────────────

  /** @private */
  _buildSnapshot(index) {
    const frame = SensorState.history[index];
    if (!frame) {
      return { timestamp: 0, readings: {}, index, activeAlertIds: [] };
    }

    // Alertas presentes en EventMarkers hasta (incluido) el timestamp del frame.
    // EventMarkers solo tracea alertas active:true — no reconstruye resoluciones.
    // Como simplificación, devolvemos todos los ids únicos de alertas hasta ese
    // instante. El orden cronológico del histórico sigue intacto.
    const markers = EventMarkers.getInRange(0, frame.timestamp);
    const seen    = new Set();
    const activeAlertIds = [];
    for (const m of markers) {
      if (m.type !== 'alert' || !m.id) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      activeAlertIds.push(m.id);
    }

    return {
      timestamp:      frame.timestamp,
      readings:       { ...frame.readings },
      index,
      activeAlertIds,
    };
  },

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  destroy() {
    this._handlers.forEach(([event, handler]) => EventBus.off(event, handler));
    this._handlers    = [];
    this._subscribers.clear();
    this._active      = false;
    this._index       = null;
  },
};

export default ReplayController;
