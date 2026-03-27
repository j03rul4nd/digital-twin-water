/**
 * ColorMapper.js — Mapea el valor de un sensor al color del material del mesh.
 *
 * REGLA CRÍTICA (Decisión 13):
 *   ColorMapper toca EXCLUSIVAMENTE material.color.
 *   Nunca toca emissive ni emissiveIntensity — eso es responsabilidad de AlertSystem.
 *   La separación de capas garantiza que el overlay de alerta no interfiere
 *   con el color de proceso.
 *
 * Colores según DESIGN.md (tokens semánticos):
 *   normal  → #22c55e (--green)
 *   warning → #f59e0b (--amber)
 *   danger  → #ef4444 (--red)
 *
 * Uso: ColorMapper.apply(mesh, sensorId, value)
 */

import { SENSORS } from '../sensors/SensorConfig.js';

// Cache de colores — evita crear objetos THREE.Color en cada tick
const COLOR_NORMAL  = 0x22c55e;
const COLOR_WARNING = 0xf59e0b;
const COLOR_DANGER  = 0xef4444;
const COLOR_NEUTRAL = 0x666666; // estado antes del primer tick

/**
 * Devuelve el estado de proceso de un sensor dado su valor actual.
 * @param {string} sensorId
 * @param {number} value
 * @returns {'normal' | 'warning' | 'danger' | 'unknown'}
 */
export function getSensorState(sensorId, value) {
  const config = SENSORS.find(s => s.id === sensorId);
  if (!config) return 'unknown';

  const inDanger = value < config.danger.low || value > config.danger.high;
  if (inDanger) return 'danger';

  const inWarning = value < config.warning.low || value > config.warning.high;
  if (inWarning) return 'warning';

  return 'normal';
}

/**
 * Devuelve el color hex correspondiente al estado de un sensor.
 * @param {'normal' | 'warning' | 'danger' | 'unknown'} state
 * @returns {number} color hex
 */
export function getColorForState(state) {
  switch (state) {
    case 'normal':  return COLOR_NORMAL;
    case 'warning': return COLOR_WARNING;
    case 'danger':  return COLOR_DANGER;
    default:        return COLOR_NEUTRAL;
  }
}

const ColorMapper = {
  /**
   * Aplica el color de proceso al material del mesh según el valor del sensor.
   * Solo toca material.color — nunca emissive ni emissiveIntensity.
   *
   * @param {THREE.Mesh} mesh
   * @param {string} sensorId
   * @param {number} value
   */
  apply(mesh, sensorId, value) {
    if (!mesh?.material) return;

    const state = getSensorState(sensorId, value);
    const color = getColorForState(state);

    // Actualización directa de color — evita crear objetos intermedios
    mesh.material.color.setHex(color);
  },

  /**
   * Resetea el mesh al color neutro (estado antes del primer tick).
   * @param {THREE.Mesh} mesh
   */
  reset(mesh) {
    if (!mesh?.material) return;
    mesh.material.color.setHex(COLOR_NEUTRAL);
  },
};

export default ColorMapper;