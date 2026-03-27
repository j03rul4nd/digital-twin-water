/**
 * SensorSceneMap.js — Binding entre IDs de sensor y nombres de mesh 3D.
 *
 * Contrato de arquitectura. Debe existir antes de escribir ModelFactory.js.
 * Los nombres de mesh aquí definidos deben coincidir EXACTAMENTE con
 * los mesh.name asignados en ModelFactory.js.
 *
 * SceneUpdater consulta este mapa para saber qué meshes actualizar
 * cuando llega un snapshot de sensor. Nunca hardcodea nombres de mesh.
 *
 * Política de IDs desconocidos (Decisión 3):
 *   Si SceneUpdater recibe un sensorId que no está en este mapa
 *   (sensor añadido en fork, topic MQTT con nombre distinto):
 *   - DEV:  console.warn visible
 *   - PROD: ignorado silenciosamente
 *   Nunca lanza un error que rompa el bucle de actualización.
 *
 * Un sensor puede estar vinculado a uno o varios meshes.
 * Todos los meshes de la lista se actualizan juntos.
 */

export const SENSOR_SCENE_MAP = {
  inlet_flow:         ['mesh_inlet_pipe', 'mesh_inlet_channel'],
  raw_turbidity:      ['mesh_raw_water_tank'],
  coag_ph:            ['mesh_coag_tank_1', 'mesh_coag_tank_2'],
  filter_1_dp:        ['mesh_filter_1'],
  filter_2_dp:        ['mesh_filter_2'],
  filtered_turbidity: ['mesh_filtered_water_pipe'],
  chlorine_dose:      ['mesh_chlorination_room'],
  residual_chlorine:  ['mesh_distribution_pipe'],
  tank_level:         ['mesh_clearwell_tank'],
  outlet_pressure:    ['mesh_pump_station'],
};

/**
 * Devuelve los nombres de mesh vinculados a un sensorId.
 * Emite un warn en dev si el ID no existe en el mapa.
 * @param {string} sensorId
 * @returns {string[]} — array vacío si el ID no existe
 */
export function getMeshNames(sensorId) {
  if (!(sensorId in SENSOR_SCENE_MAP)) {
    if (import.meta.env.DEV) {
      console.warn(`SensorSceneMap: sensorId desconocido "${sensorId}" — ignorado.`);
    }
    return [];
  }
  return SENSOR_SCENE_MAP[sensorId];
}

export default SENSOR_SCENE_MAP;