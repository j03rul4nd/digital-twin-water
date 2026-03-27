/**
 * AlertSystem.js — Overlay visual de alerta sobre meshes 3D.
 *
 * REGLA CRÍTICA (Decisión 13):
 *   AlertSystem toca EXCLUSIVAMENTE material.emissive y material.emissiveIntensity.
 *   Nunca toca material.color — eso es responsabilidad de ColorMapper.
 *   Cuando una alerta se resuelve, quita el overlay. El mesh recupera
 *   visualmente el color base que ColorMapper ha seguido actualizando — sin conflicto.
 *
 * Escucha EVENTS.RULE_TRIGGERED.
 * Para cada alerta activa, aplica glow a los meshes vinculados via SensorSceneMap.
 * Para cada alerta resuelta (active: false), elimina el glow.
 *
 * emissiveIntensity: 0.35 — visible en la escena oscura pero el material
 * mantiene su identidad visual. Valores >0.5 convierten el mesh en un blob saturado.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import { getMeshNames } from '../sensors/SensorSceneMap.js';
import SceneManager from '../core/SceneManager.js';

// Colores de glow por severidad (emissive, no material.color)
const EMISSIVE_DANGER  = 0xef4444;
const EMISSIVE_WARNING = 0xf59e0b;
const EMISSIVE_INTENSITY = 0.35;

const AlertSystem = {
  /** @type {Function} — referencia guardada para poder llamar a EventBus.off */
  _handler: null,

  /**
   * Registra el listener de alertas.
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    this._handler = (alert) => this._handleAlert(alert);
    EventBus.on(EVENTS.RULE_TRIGGERED, this._handler);
  },

  /**
   * @param {{ id: string, severity: 'warning'|'danger', sensorIds: string[], active: boolean }} alert
   */
  _handleAlert(alert) {
    if (alert.active) {
      this._applyGlow(alert);
    } else {
      this._removeGlow(alert);
    }
  },

  /**
   * Aplica el glow emissive a todos los meshes vinculados a los sensores de la alerta.
   */
  _applyGlow(alert) {
    const emissiveColor = alert.severity === 'danger' ? EMISSIVE_DANGER : EMISSIVE_WARNING;

    alert.sensorIds.forEach(sensorId => {
      const meshNames = getMeshNames(sensorId);
      meshNames.forEach(name => {
        const mesh = this._getMesh(name);
        if (!mesh) return;
        // Solo toca emissive — nunca material.color
        mesh.material.emissive.setHex(emissiveColor);
        mesh.material.emissiveIntensity = EMISSIVE_INTENSITY;
      });
    });
  },

  /**
   * Elimina el glow de todos los meshes vinculados a los sensores de la alerta resuelta.
   * ColorMapper sigue actualizando material.color en cada tick — no hay estado stale.
   */
  _removeGlow(alert) {
    alert.sensorIds.forEach(sensorId => {
      const meshNames = getMeshNames(sensorId);
      meshNames.forEach(name => {
        const mesh = this._getMesh(name);
        if (!mesh) return;
        mesh.material.emissiveIntensity = 0;
      });
    });
  },

  /**
   * Busca un mesh por nombre en la escena.
   * Devuelve null si no existe (sin lanzar error — política de IDs desconocidos).
   * @param {string} name
   * @returns {THREE.Mesh | null}
   */
  _getMesh(name) {
    if (!SceneManager.scene) return null;
    const obj = SceneManager.scene.getObjectByName(name);
    if (!obj) {
      if (import.meta.env.DEV) {
        console.warn(`AlertSystem: mesh "${name}" no encontrado en la escena.`);
      }
      return null;
    }
    return obj;
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.RULE_TRIGGERED, this._handler);
      this._handler = null;
    }
  },
};

export default AlertSystem;