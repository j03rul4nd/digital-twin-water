/**
 * DataSourceManager.js — Máquina de estados para la fuente de datos activa.
 *
 * Estado: 'none' | 'simulation' | 'mqtt'
 *
 * REGLA DE ARQUITECTURA:
 *   Ningún módulo activa ni desactiva la simulación directamente.
 *   Toda transición pasa por aquí. Esta es la única fuente de verdad
 *   sobre qué fuente de datos está activa en cada momento.
 *
 * Flujo de transición limpia:
 *   1. Emite DATA_SOURCE_CLEARING → módulos de UI se auto-limpian
 *   2. SensorState.reset() + RuleEngine.clearAlerts() → estado de datos limpio
 *   3. Emite DATA_SOURCE_CHANGED { mode } → módulos actualizan su UI
 *
 * Garantía de no-mezcla:
 *   Al pasar de simulación a 'none' o 'mqtt', el Worker se detiene completamente
 *   (terminate). No quedan datos simulados en SensorState.history ni en
 *   los buffers internos de ningún módulo.
 *
 * Garantía de no-auto-reanudación:
 *   MQTT_DISCONNECTED y MQTT_ERROR llevan el modo a 'none', nunca a 'simulation'.
 *   La simulación solo se activa por acción explícita del usuario.
 */

import EventBus    from './EventBus.js';
import { EVENTS }  from './events.js';
import SensorState  from '../sensors/SensorState.js';
import RuleEngine   from '../sensors/RuleEngine.js';
import SensorWorker from '../sensors/SensorWorker.js';

const DataSourceManager = {
  /** @type {'none' | 'simulation' | 'mqtt'} */
  _mode: 'none',

  /**
   * Registra los listeners de MQTT.
   * Llamar en el paso 3 de init() en main.js, ANTES de cualquier Worker.
   */
  init() {
    // Al confirmar sesión MQTT: detener simulación si corría, limpiar, cambiar a 'mqtt'
    EventBus.on(EVENTS.MQTT_CONNECTED, () => {
      if (this._mode === 'simulation') {
        SensorWorker.stop();
      }
      this._clearState();
      this._setMode('mqtt');
    });

    // En error MQTT: limpiar, volver a 'none' — NUNCA reanudar simulación
    EventBus.on(EVENTS.MQTT_ERROR, () => {
      if (this._mode === 'mqtt') {
        this._clearState();
        this._setMode('none');
      }
    });

    // Al desconectar MQTT: limpiar, volver a 'none' — NUNCA reanudar simulación
    EventBus.on(EVENTS.MQTT_DISCONNECTED, () => {
      if (this._mode === 'mqtt') {
        this._clearState();
        this._setMode('none');
      }
    });
  },

  /** Devuelve el modo activo. */
  getMode() { return this._mode; },
  isSimulating() { return this._mode === 'simulation'; },
  isMQTT()       { return this._mode === 'mqtt'; },

  /**
   * Iniciar modo simulación.
   * No-op si ya está en simulación.
   * No-op si hay MQTT activo (el usuario debe desconectar primero).
   */
  startSimulation() {
    if (this._mode === 'simulation') return;
    if (this._mode === 'mqtt') {
      console.warn('DataSourceManager: no se puede iniciar simulación con MQTT activo.');
      return;
    }
    this._clearState();
    this._setMode('simulation');
    SensorWorker.start();
  },

  /**
   * Detener modo simulación y limpiar todo el estado simulado.
   * No-op si no está en simulación.
   */
  stopSimulation() {
    if (this._mode !== 'simulation') return;
    SensorWorker.stop();
    this._clearState();
    this._setMode('none');
  },

  // ─── Internos ─────────────────────────────────────────────────────────────

  /**
   * Limpieza completa antes de cualquier cambio de fuente.
   *
   * Orden garantizado:
   *   1. DATA_SOURCE_CLEARING → módulos de UI se auto-limpian (AlertPanel, KPIEngine, Toolbar…)
   *   2. SensorState.reset()  → borra readings e histórico
   *   3. RuleEngine.clearAlerts() → emite RULE_TRIGGERED active:false por cada alerta activa
   *      (AlertSystem quita los glows; AlertPanel ya está limpio, ignora los eventos)
   */
  _clearState() {
    EventBus.emit(EVENTS.DATA_SOURCE_CLEARING);
    SensorState.reset();
    RuleEngine.clearAlerts();
  },

  _setMode(mode) {
    this._mode = mode;
    EventBus.emit(EVENTS.DATA_SOURCE_CHANGED, { mode });
  },
};

export default DataSourceManager;
