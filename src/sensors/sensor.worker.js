/**
 * sensor.worker.js — Web Worker del simulador de sensores.
 *
 * Genera un snapshot completo de los 10 sensores cada 500ms.
 * Corre en un thread separado para proteger el render loop de Three.js.
 *
 * Correlaciones causales implementadas (Decisión 14):
 *   inlet_flow       → raw_turbidity  (más caudal → más sedimentos)
 *   inlet_flow       → chlorine_dose  (más agua → más cloro necesario)
 *   filter_1_dp      → filtered_turbidity (filtro colmatado → peor filtración)
 *   filter_1_dp      tiene colmatación progresiva con retrolavado simulado
 *
 * Estas correlaciones son las que hacen que el RuleEngine dispare alertas
 * reales durante el demo. Sin ellas, las reglas de correlación nunca se activan.
 *
 * Política de valores inválidos (Decisión 1):
 *   Si un sensor no puede generar valor en un tick, se envía el último
 *   valor válido conocido — nunca null, nunca undefined, nunca clave ausente.
 *   El primer tick usa el punto medio del rango normal si no hay valor previo.
 *
 * Comandos aceptados via postMessage:
 *   { cmd: 'start' }  — arranca el intervalo (implícito al cargar)
 *   { cmd: 'pause' }  — pausa el simulador (cuando MQTT conecta)
 *   { cmd: 'resume' } — reanuda el simulador (cuando MQTT desconecta o falla)
 *   { cmd: 'stop' }   — detiene el simulador definitivamente
 */

import { noise } from '../utils/NoiseGenerator.js';

// ─── Estado interno del simulador ─────────────────────────────────────────────

/** Último valor válido por sensorId — garantiza que nunca enviamos null */
const lastValid = {
  inlet_flow:         120,
  raw_turbidity:      4.0,
  coag_ph:            7.0,
  filter_1_dp:        40,
  filter_2_dp:        45,
  filtered_turbidity: 0.25,
  chlorine_dose:      1.8,
  residual_chlorine:  0.5,
  tank_level:         65,
  outlet_pressure:    4.5,
};

/** Estado de colmatación progresiva de los filtros */
let filter1DpCurrent = 40;
let filter2DpCurrent = 45;

/** Flag de pausa — true cuando el MQTTAdapter está activo */
let paused = false;

/** Referencia al setInterval para poder limpiarlo */
let intervalId = null;

// ─── Lógica de simulación ──────────────────────────────────────────────────────

/**
 * Genera un snapshot completo de todos los sensores.
 * El orden de cálculo es causal — los sensores dependientes
 * se calculan después de los drivers primarios.
 * @returns {{ timestamp: number, readings: Record<string, number> }}
 */
function generateSnapshot() {
  const readings = {};

  try {
    // 1. inlet_flow — driver primario independiente
    const inletFlow = Math.max(20, Math.min(260,
      120 + noise('inlet_flow', 30, 0.025)
    ));
    readings.inlet_flow = parseFloat(inletFlow.toFixed(1));

    // 2. raw_turbidity — correlaciona con inlet_flow
    // Más caudal → más sedimentos en suspensión
    const rawTurb = Math.max(0.5, Math.min(60,
      3.0 + (inletFlow / 200) * 3.0 + noise('raw_turbidity', 2.0, 0.04)
    ));
    readings.raw_turbidity = parseFloat(rawTurb.toFixed(2));

    // 3. coag_ph — relativamente independiente, varía lentamente
    const coagPh = Math.max(5.5, Math.min(8.5,
      7.0 + noise('coag_ph', 0.6, 0.015)
    ));
    readings.coag_ph = parseFloat(coagPh.toFixed(2));

    // 4. filter_1_dp — colmatación progresiva con retrolavado simulado
    filter1DpCurrent = filter1DpCurrent + 0.12 + noise('filter_1_dp_drift', 0.08, 0.02);
    if (filter1DpCurrent > 210) {
      // Retrolavado: la presión diferencial baja de golpe
      filter1DpCurrent = 20 + Math.random() * 10;
    }
    const filter1Dp = Math.max(15, Math.min(230,
      filter1DpCurrent + noise('filter_1_dp', 3, 0.05)
    ));
    readings.filter_1_dp = parseFloat(filter1Dp.toFixed(1));

    // 5. filter_2_dp — también progresivo pero desfasado de filter_1
    filter2DpCurrent = filter2DpCurrent + 0.09 + noise('filter_2_dp_drift', 0.06, 0.018);
    if (filter2DpCurrent > 205) {
      filter2DpCurrent = 22 + Math.random() * 10;
    }
    const filter2Dp = Math.max(15, Math.min(230,
      filter2DpCurrent + noise('filter_2_dp', 3, 0.048)
    ));
    readings.filter_2_dp = parseFloat(filter2Dp.toFixed(1));

    // 6. filtered_turbidity — correlaciona con filter_1_dp
    // Filtro colmatado (DP alto) → peor filtración → más turbidez filtrada
    const filteredTurb = Math.max(0.05, Math.min(1.5,
      0.15 + (filter1Dp / 210) * 0.9 + noise('filtered_turbidity', 0.05, 0.06)
    ));
    readings.filtered_turbidity = parseFloat(filteredTurb.toFixed(3));

    // 7. chlorine_dose — debe escalar con inlet_flow
    // Si NO escala, el RuleEngine detecta déficit de desinfección
    const chlorineDose = Math.max(0.3, Math.min(4.5,
      1.0 * (inletFlow / 150) + noise('chlorine_dose', 0.3, 0.035)
    ));
    readings.chlorine_dose = parseFloat(chlorineDose.toFixed(2));

    // 8. residual_chlorine — correlaciona con chlorine_dose (con lag)
    const residualCl = Math.max(0.05, Math.min(1.8,
      chlorineDose * 0.28 + noise('residual_chlorine', 0.08, 0.04)
    ));
    readings.residual_chlorine = parseFloat(residualCl.toFixed(3));

    // 9. tank_level — varía lentamente, semi-independiente
    const tankLevel = Math.max(15, Math.min(98,
      65 + noise('tank_level', 20, 0.008)
    ));
    readings.tank_level = parseFloat(tankLevel.toFixed(1));

    // 10. outlet_pressure — correlaciona levemente con tank_level
    const outletPressure = Math.max(1.5, Math.min(7.5,
      4.0 + (tankLevel / 100) * 1.0 + noise('outlet_pressure', 0.5, 0.03)
    ));
    readings.outlet_pressure = parseFloat(outletPressure.toFixed(2));

    // Actualizar lastValid con los valores generados exitosamente
    Object.assign(lastValid, readings);

  } catch (err) {
    // Si algo falla internamente, usar los últimos valores válidos
    // para todas las claves que no se hayan calculado aún.
    // Garantiza que el snapshot siempre tiene las 10 claves.
    console.warn('sensor.worker: error generando snapshot, usando últimos válidos', err);
    Object.keys(lastValid).forEach(key => {
      if (!(key in readings)) readings[key] = lastValid[key];
    });
  }

  // Seguridad final: garantizar que las 10 claves están presentes
  Object.keys(lastValid).forEach(key => {
    if (!(key in readings) || !Number.isFinite(readings[key])) {
      readings[key] = lastValid[key];
    }
  });

  return {
    timestamp: Date.now(),
    readings,
  };
}

// ─── Loop del simulador ────────────────────────────────────────────────────────

function startLoop() {
  if (intervalId !== null) return; // ya está corriendo
  intervalId = setInterval(() => {
    if (paused) return;
    const snapshot = generateSnapshot();
    self.postMessage(snapshot);
  }, 500);
}

function stopLoop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ─── Gestión de comandos desde main.js ────────────────────────────────────────

self.addEventListener('message', ({ data }) => {
  switch (data?.cmd) {
    case 'start':
      paused = false;
      startLoop();
      break;
    case 'pause':
      // Completa el tick en curso y deja de emitir.
      // Puede llegar un tick más después de que MQTT_CONNECTED se emita — es esperado.
      paused = true;
      break;
    case 'resume':
      paused = false;
      if (intervalId === null) startLoop();
      break;
    case 'stop':
      stopLoop();
      break;
    default:
      if (import.meta.env?.DEV) {
        console.warn('sensor.worker: comando desconocido', data);
      }
  }
});

// Arrancar automáticamente al cargar el Worker
startLoop();