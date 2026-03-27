/**
 * NoiseGenerator.js — Generador de ruido suavizado por sensor.
 *
 * Importado por sensor.worker.js para generar variaciones realistas.
 * Mantiene estado interno de fase por sensorId — valores consecutivos
 * no dan saltos bruscos (sin ruido blanco puro).
 *
 * Sin inicialización externa — el estado se crea en el primer uso.
 *
 * API pública:
 *   noise(sensorId, amplitude, speed?) → número en [-amplitude, +amplitude]
 *   resetNoise()                       → limpia todas las fases
 */

/** @type {Record<string, number>} Fase acumulada por sensorId */
const phases = {};

/**
 * Genera un valor de ruido suavizado para un sensor.
 *
 * Usa seno con fase acumulada para suavidad temporal.
 * Cada sensor tiene su propia fase independiente — sin esto,
 * todos los sensores oscilarían en sincronía, lo que se ve artificial.
 *
 * @param {string} sensorId  — ID del sensor (e.g. 'inlet_flow'). Clave de fase.
 * @param {number} amplitude — Magnitud máxima del ruido (± amplitude alrededor de 0).
 * @param {number} [speed]   — Velocidad de cambio. 0.01 = muy lento, 0.1 = rápido.
 *                             Por defecto 0.03 (variación media, realista para proceso industrial).
 * @returns {number}         — Valor de ruido en el rango [-amplitude, +amplitude].
 */
export function noise(sensorId, amplitude, speed = 0.03) {
  if (phases[sensorId] === undefined) {
    // Fase inicial aleatoria para que los sensores no estén sincronizados al arrancar
    phases[sensorId] = Math.random() * Math.PI * 2;
  }
  phases[sensorId] += speed;
  return Math.sin(phases[sensorId]) * amplitude;
}

/**
 * Resetea la fase de todos los sensores.
 * Llamar desde main.js junto a SensorState.reset() si se quiere
 * reiniciar el simulador con valores completamente frescos.
 */
export function resetNoise() {
  Object.keys(phases).forEach(k => delete phases[k]);
}