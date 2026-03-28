/**
 * SensorState.js — Singleton. Única fuente de verdad del estado actual de los sensores.
 *
 * Contrato de arquitectura. No es un EventBus — no emite nada.
 * Los módulos leen de aquí; se notifican del cambio via EventBus (SENSOR_UPDATE).
 *
 * Añadido: getTrend(sensorId, windowSeconds) para detección de tendencias
 * en el RuleEngine sin duplicar lógica de análisis en cada regla.
 */

const SensorState = {
  readings:      {},
  lastTimestamp: null,
  history:       [],
  MAX_HISTORY:   360, // 360 × 500ms = 3 minutos

  update(snapshot) {
    this.readings      = snapshot.readings;
    this.lastTimestamp = snapshot.timestamp;
    this.history.push({ timestamp: snapshot.timestamp, readings: { ...snapshot.readings } });
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
  },

  get(sensorId) {
    return this.readings[sensorId];
  },

  isReady() {
    return this.lastTimestamp !== null;
  },

  getHistory(sensorId, n = SensorState.MAX_HISTORY) {
    return this.history.slice(-n).map(s => ({
      timestamp: s.timestamp,
      value:     s.readings[sensorId],
    }));
  },

  /**
   * Analiza la tendencia de un sensor en una ventana temporal.
   *
   * Devuelve un objeto con:
   *   slope      — cambio por segundo (positivo = subiendo, negativo = bajando)
   *   delta      — diferencia total entre el primer y último valor de la ventana
   *   deltaRel   — delta relativo al primer valor (0.4 = subió un 40%)
   *   direction  — 'rising' | 'falling' | 'stable'
   *   samples    — número de muestras en la ventana
   *   mean       — media de los valores en la ventana
   *   first      — primer valor de la ventana
   *   last       — último valor de la ventana (más reciente)
   *
   * Devuelve null si no hay suficientes datos (< 2 muestras en la ventana).
   *
   * @param {string} sensorId
   * @param {number} windowSeconds — ventana de análisis en segundos (e.g. 60 = último minuto)
   * @param {number} [stableThreshold] — pendiente por debajo de la cual se considera estable (default 0.05)
   * @returns {{ slope, delta, deltaRel, direction, samples, mean, first, last } | null}
   */
  getTrend(sensorId, windowSeconds, stableThreshold = 0.05) {
    if (this.history.length < 2) return null;

    const now        = this.lastTimestamp ?? Date.now();
    const cutoff     = now - windowSeconds * 1000;
    const window     = this.history
      .filter(s => s.timestamp >= cutoff)
      .map(s => ({ t: s.timestamp, v: s.readings[sensorId] }))
      .filter(p => typeof p.v === 'number' && isFinite(p.v));

    if (window.length < 2) return null;

    const first = window[0].v;
    const last  = window[window.length - 1].v;
    const delta = last - first;

    // Pendiente mediante regresión lineal simple (mínimos cuadrados)
    // Da una pendiente más robusta que la simple diferencia first/last
    const n      = window.length;
    const tBase  = window[0].t; // normalizar timestamps para evitar overflow
    let sumT = 0, sumV = 0, sumTV = 0, sumTT = 0;
    window.forEach(({ t, v }) => {
      const tn = (t - tBase) / 1000; // en segundos
      sumT  += tn;
      sumV  += v;
      sumTV += tn * v;
      sumTT += tn * tn;
    });
    const denom = n * sumTT - sumT * sumT;
    const slope = denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;

    const deltaRel = first !== 0 ? delta / Math.abs(first) : 0;
    const mean     = sumV / n;

    let direction;
    if      (Math.abs(slope) < stableThreshold) direction = 'stable';
    else if (slope > 0)                          direction = 'rising';
    else                                         direction = 'falling';

    return { slope, delta, deltaRel, direction, samples: n, mean, first, last };
  },

  reset() {
    this.readings      = {};
    this.lastTimestamp = null;
    this.history       = [];
  },
};

export default SensorState;