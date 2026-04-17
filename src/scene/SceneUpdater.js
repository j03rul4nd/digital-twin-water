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
import ReplayController from '../core/ReplayController.js';
import EventMarkers from '../charts/EventMarkers.js';

// Emissive intensity / colores aplicados durante replay al repintar alertas
// del snapshot. Deben coincidir con los que usa AlertSystem.
const REPLAY_EMISSIVE_DANGER  = 0xef4444;
const REPLAY_EMISSIVE_WARNING = 0xf59e0b;
const REPLAY_EMISSIVE_INTENSITY = 0.35;

const SceneUpdater = {
  /** @type {Function} */
  _handler:       null,
  _replayHandler: null,
  _exitHandler:   null,

  /**
   * Registra el listener de datos.
   * Llamar en el paso 4 de init() en main.js, después de SceneManager y ModelFactory.
   */
  init() {
    // Live updates (saltadas durante replay)
    this._handler = (snapshot) => {
      if (ReplayController.isActive()) return;
      this._update(snapshot);
    };
    EventBus.on(EVENTS.SENSOR_UPDATE, this._handler);

    // Replay: pintar desde el snapshot histórico (color + emissive)
    this._replayHandler = ({ snapshot }) => {
      if (!snapshot) return;
      this._update({ timestamp: snapshot.timestamp, readings: snapshot.readings });
      this._applyReplayAlerts(snapshot.activeAlertIds || []);
    };
    EventBus.on(EVENTS.REPLAY_ENTERED,  this._replayHandler);
    EventBus.on(EVENTS.REPLAY_SCRUBBED, this._replayHandler);

    // Al salir: limpiar emissive glows aplicados en replay y repintar con
    // el estado live actual. AlertSystem retomará su lógica normal a partir
    // de los próximos RULE_TRIGGERED.
    this._exitHandler = () => {
      this._clearAllEmissive();
      if (SensorState.isReady()) {
        this._update({ timestamp: SensorState.lastTimestamp, readings: SensorState.readings });
      }
    };
    EventBus.on(EVENTS.REPLAY_EXITED, this._exitHandler);
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
   * Durante replay, reemplaza el estado emissive de TODOS los meshes a partir
   * del conjunto de alertas activas del snapshot. Como este método se llama
   * en cada scrub, primero limpiamos todos los emissive y luego aplicamos
   * solo los que correspondan a alertas del snapshot.
   */
  _applyReplayAlerts(alertIds) {
    if (!SceneManager.scene) return;

    this._clearAllEmissive();
    if (!alertIds.length) return;

    // Indexar metadata desde EventMarkers por id (severity + sensorIds)
    const byId = new Map();
    for (const ev of (EventMarkers._events || [])) {
      if (ev.type === 'alert' && ev.id) byId.set(ev.id, ev);
    }

    for (const id of alertIds) {
      const ev = byId.get(id);
      if (!ev) continue;
      const color = ev.severity === 'danger' ? REPLAY_EMISSIVE_DANGER : REPLAY_EMISSIVE_WARNING;
      for (const sensorId of (ev.sensorIds || [])) {
        for (const name of getMeshNames(sensorId)) {
          const mesh = SceneManager.scene.getObjectByName(name);
          if (!mesh || !mesh.material?.emissive) continue;
          mesh.material.emissive.setHex(color);
          mesh.material.emissiveIntensity = REPLAY_EMISSIVE_INTENSITY;
        }
      }
    }
  },

  /**
   * Limpia el emissive de todos los meshes que puedan tenerlo aplicado.
   * Itera sobre los nombres conocidos del SensorSceneMap.
   */
  _clearAllEmissive() {
    if (!SceneManager.scene) return;
    SceneManager.scene.traverse(obj => {
      if (obj.isMesh && obj.material?.emissive) {
        obj.material.emissiveIntensity = 0;
      }
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
    if (this._replayHandler) {
      EventBus.off(EVENTS.REPLAY_ENTERED,  this._replayHandler);
      EventBus.off(EVENTS.REPLAY_SCRUBBED, this._replayHandler);
      this._replayHandler = null;
    }
    if (this._exitHandler) {
      EventBus.off(EVENTS.REPLAY_EXITED, this._exitHandler);
      this._exitHandler = null;
    }
  },
};

export default SceneUpdater;