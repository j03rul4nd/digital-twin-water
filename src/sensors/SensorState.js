/**
 * SensorState.js — Singleton. Única fuente de verdad del estado actual de los sensores.
 *
 * Contrato de arquitectura. No es un EventBus — no emite nada.
 * Los módulos leen de aquí; se notifican del cambio via EventBus (SENSOR_UPDATE).
 *
 * Flujo:
 *   Worker / MQTTAdapter → main.js → SensorState.update(snapshot)
 *                                  → EventBus.emit(SENSOR_UPDATE, snapshot)
 *
 * Módulos que leen de aquí: TelemetryPanel, RuleEngine, SceneUpdater, DataExporter.
 *
 * IMPORTANTE: Comprobar isReady() antes de actuar sobre los datos.
 * Durante los primeros ~500ms del arranque, readings es {} y isReady() devuelve false.
 */

const SensorState = {
  /** Última lectura de cada sensor. {} hasta el primer tick. */
  readings: {},

  /** Timestamp del último snapshot recibido. null hasta el primer tick. */
  lastTimestamp: null,

  /**
   * Buffer circular de los últimos MAX_HISTORY snapshots.
   * Cada entrada: { timestamp: number, readings: Record<string, number> }
   * Usado por DataExporter y para futuros gráficos de tendencia.
   */
  history: [],

  /**
   * Número máximo de snapshots en el histórico.
   * 360 snapshots × 500ms = 3 minutos de histórico ≈ 72KB en memoria.
   */
  MAX_HISTORY: 360,

  /**
   * Actualiza el estado con un nuevo snapshot completo.
   * Llamado por main.js en cada tick del Worker o del MQTTAdapter.
   * @param {{ timestamp: number, readings: Record<string, number> }} snapshot
   */
  update(snapshot) {
    this.readings = snapshot.readings;
    this.lastTimestamp = snapshot.timestamp;
    this.history.push({ timestamp: snapshot.timestamp, readings: { ...snapshot.readings } });
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }
  },

  /**
   * Devuelve el valor actual de un sensor.
   * Devuelve undefined si aún no hay datos (antes del primer tick).
   * @param {string} sensorId
   * @returns {number | undefined}
   */
  get(sensorId) {
    return this.readings[sensorId];
  },

  /**
   * true cuando ha llegado al menos un tick de datos.
   * Usar antes de leer readings en cualquier módulo.
   * @returns {boolean}
   */
  isReady() {
    return this.lastTimestamp !== null;
  },

  /**
   * Devuelve los últimos N snapshots del sensor indicado, del más antiguo al más reciente.
   * Usado por DataExporter y futuros gráficos de tendencia.
   * @param {string} sensorId
   * @param {number} [n] — número de snapshots (por defecto MAX_HISTORY)
   * @returns {{ timestamp: number, value: number }[]}
   */
  getHistory(sensorId, n = SensorState.MAX_HISTORY) {
    return this.history.slice(-n).map(s => ({
      timestamp: s.timestamp,
      value: s.readings[sensorId],
    }));
  },

  /**
   * Resetea el estado completamente.
   * Llamar desde main.js al cambiar de fuente de datos (Worker → MQTT o viceversa).
   * Garantiza que DataExporter no mezcle datos de dos fuentes distintas.
   * RuleEngine también debe limpiar sus alertas activas en el mismo momento.
   */
  reset() {
    this.readings = {};
    this.lastTimestamp = null;
    this.history = [];
  },
};

export default SensorState;