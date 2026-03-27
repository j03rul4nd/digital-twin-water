/**
 * SceneUpdater.js — Coordina ColorMapper y AlertSystem sobre los meshes 3D.
 *
 * Escucha EVENTS.SENSOR_UPDATE. En cada tick:
 *   1. Para cada sensor del snapshot, obtiene los meshes vinculados via getMeshNames()
 *   2. Llama a ColorMapper.apply() en cada mesh (toca material.color)
 *   AlertSystem actúa por su cuenta al recibir RULE_TRIGGERED (toca emissiveIntensity)
 *
 * No actúa hasta que SensorState.isReady() es true — el primer tick tarda ~500ms.
 * Antes de eso, los meshes muestran el color neutro de ModelFactory (#666).
 *
 * Política de IDs desconocidos (Decisión 3):
 *   getMeshNames() ya maneja el warn en dev y devuelve [] si el ID no existe.
 *   Un sensor desconocido no rompe el bucle de actualización de los otros 9.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import SensorState from '../sensors/SensorState.js';
import { getMeshNames } from '../sensors/SensorSceneMap.js';
import ColorMapper from './ColorMapper.js';
import SceneManager from '../core/SceneManager.js';

const SceneUpdater = {
  /** @type {Function} */
  _handler: null,

  /**
   * Registra el listener de datos.
   * Llamar en el paso 4 de init() en main.js, después de SceneManager y ModelFactory.
   */
  init() {
    this._handler = (snapshot) => this._update(snapshot);
    EventBus.on(EVENTS.SENSOR_UPDATE, this._handler);
  },

  /**
   * Actualiza el color de todos los meshes del snapshot.
   * @param {{ timestamp: number, readings: Record<string, number> }} snapshot
   */
  _update(snapshot) {
    // No actuar hasta que haya datos reales
    if (!SensorState.isReady()) return;
    if (!SceneManager.scene) return;

    const { readings } = snapshot;

    // Para cada sensor del snapshot, actualizar los meshes vinculados
    Object.entries(readings).forEach(([sensorId, value]) => {
      // getMeshNames() devuelve [] y emite warn en dev si el ID no existe
      const meshNames = getMeshNames(sensorId);

      meshNames.forEach(name => {
        const mesh = SceneManager.scene.getObjectByName(name);
        if (!mesh) {
          if (import.meta.env.DEV) {
            console.warn(`SceneUpdater: mesh "${name}" no encontrado en la escena.`);
          }
          return;
        }
        // ColorMapper solo toca material.color — AlertSystem gestiona emissiveIntensity
        ColorMapper.apply(mesh, sensorId, value);
      });
    });
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

export default SceneUpdater;