/**
 * SensorConfig.js — Definición de los 10 sensores de la planta WTP.
 *
 * Contrato de arquitectura. Debe existir antes de cualquier módulo
 * que consuma datos de sensor o evalúe umbrales.
 *
 * Cada sensor define:
 *   - id:         identificador único (coincide con las claves de readings en SensorState)
 *   - label:      nombre legible para la UI
 *   - unit:       unidad de medida
 *   - rangeMin:   mínimo del rango de visualización (para la barra de progreso)
 *   - rangeMax:   máximo del rango de visualización
 *   - normal:     { low, high } — rango operativo normal
 *   - warning:    { low, high } — zona de advertencia
 *   - danger:     { low, high } — zona de peligro
 *
 * Orden: flujo del proceso (captación → distribución), no alfabético.
 * TelemetryPanel usa este orden para mostrar los sensores.
 */

export const SENSORS = [
  {
    id: 'inlet_flow',
    label: 'Inlet Flow Rate',
    unit: 'm³/h',
    rangeMin: 0,
    rangeMax: 300,
    normal:  { low: 50,  high: 200 },
    warning: { low: 40,  high: 220 },
    danger:  { low: 20,  high: 250 },
  },
  {
    id: 'raw_turbidity',
    label: 'Raw Water Turbidity',
    unit: 'NTU',
    rangeMin: 0,
    rangeMax: 80,
    normal:  { low: 1,  high: 10 },
    warning: { low: 0,  high: 50 },
    danger:  { low: 0,  high: 80 },
  },
  {
    id: 'coag_ph',
    label: 'Coagulation pH',
    unit: 'pH',
    rangeMin: 5,
    rangeMax: 9,
    normal:  { low: 6.5, high: 7.5 },
    warning: { low: 6.0, high: 8.0 },
    danger:  { low: 5.5, high: 8.5 },
  },
  {
    id: 'filter_1_dp',
    label: 'Filter #1 Diff. Pressure',
    unit: 'mbar',
    rangeMin: 0,
    rangeMax: 250,
    normal:  { low: 20,  high: 150 },
    warning: { low: 0,   high: 200 },
    danger:  { low: 0,   high: 250 },
  },
  {
    id: 'filter_2_dp',
    label: 'Filter #2 Diff. Pressure',
    unit: 'mbar',
    rangeMin: 0,
    rangeMax: 250,
    normal:  { low: 20,  high: 150 },
    warning: { low: 0,   high: 200 },
    danger:  { low: 0,   high: 250 },
  },
  {
    id: 'filtered_turbidity',
    label: 'Filtered Water Turbidity',
    unit: 'NTU',
    rangeMin: 0,
    rangeMax: 2,
    normal:  { low: 0.1, high: 0.5 },
    warning: { low: 0,   high: 1.0 },
    danger:  { low: 0,   high: 2.0 },
  },
  {
    id: 'chlorine_dose',
    label: 'Chlorine Dose',
    unit: 'mg/L',
    rangeMin: 0,
    rangeMax: 5,
    normal:  { low: 1.0, high: 3.0 },
    warning: { low: 0.5, high: 4.0 },
    danger:  { low: 0,   high: 5.0 },
  },
  {
    id: 'residual_chlorine',
    label: 'Residual Chlorine',
    unit: 'mg/L',
    rangeMin: 0,
    rangeMax: 2,
    normal:  { low: 0.2, high: 1.0 },
    warning: { low: 0.1, high: 1.5 },
    danger:  { low: 0,   high: 2.0 },
  },
  {
    id: 'tank_level',
    label: 'Clearwell Tank Level',
    unit: '%',
    rangeMin: 0,
    rangeMax: 100,
    normal:  { low: 40, high: 90 },
    warning: { low: 20, high: 95 },
    danger:  { low: 0,  high: 100 },
  },
  {
    id: 'outlet_pressure',
    label: 'Distribution Pressure',
    unit: 'bar',
    rangeMin: 0,
    rangeMax: 8,
    normal:  { low: 3.0, high: 6.0 },
    warning: { low: 2.0, high: 7.0 },
    danger:  { low: 0,   high: 8.0 },
  },
];

// ─── Validador (solo en dev mode) ─────────────────────────────────────────────
// Si un fork añade un sensor con un campo faltante o un rango inválido,
// el error aparece en consola al arrancar — antes de llegar al Worker o la UI.

const REQUIRED_FIELDS = ['id', 'label', 'unit', 'rangeMin', 'rangeMax', 'normal', 'warning', 'danger'];
const RANGE_FIELDS = ['normal', 'warning', 'danger'];

if (import.meta.env.DEV) {
  SENSORS.forEach(sensor => {
    REQUIRED_FIELDS.forEach(field => {
      if (!(field in sensor)) {
        throw new Error(`SensorConfig: sensor "${sensor.id ?? '?'}" missing field "${field}"`);
      }
    });

    RANGE_FIELDS.forEach(range => {
      if (!('low' in sensor[range]) || !('high' in sensor[range])) {
        throw new Error(`SensorConfig: sensor "${sensor.id}" — "${range}" must have { low, high }`);
      }
    });

    if (sensor.rangeMin >= sensor.rangeMax) {
      throw new Error(`SensorConfig: sensor "${sensor.id}" has invalid display range (rangeMin >= rangeMax)`);
    }

    if (sensor.normal.low >= sensor.normal.high) {
      throw new Error(`SensorConfig: sensor "${sensor.id}" has invalid normal range (low >= high)`);
    }
  });
}

export default SENSORS;