/**
 * sensor.worker.js — Web Worker del simulador de sensores.
 *
 * Genera un snapshot completo de los 10 sensores cada 500ms.
 * Corre en un thread separado para proteger el render loop de Three.js.
 *
 * Comandos aceptados via postMessage:
 *   { cmd: 'start' }
 *   { cmd: 'pause' }
 *   { cmd: 'resume' }
 *   { cmd: 'stop' }
 *   { cmd: 'scenario', name: string, durationMs: number }
 *     — activa un escenario de incidente durante durationMs ms
 *     — al terminar, vuelve automáticamente al modo normal
 *   { cmd: 'scenario', name: 'reset' }
 *     — cancela el escenario activo inmediatamente
 *
 * Escenarios disponibles:
 *   filter_1_clog      Filter #1 DP → 185 mbar (warning)
 *   filter_1_critical  Filter #1 DP → 215 mbar (danger)
 *   chlorine_deficit   Cloro no escala con caudal (danger)
 *   low_tank           Nivel del clearwell cae a ~18% (warning)
 *   ph_anomaly         pH de coagulación fuera de rango (warning)
 *   reset              Vuelve a normal inmediatamente
 */

import { noise } from '../utils/NoiseGenerator.js';

// ─── Estado interno ────────────────────────────────────────────────────────────

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

let filter1DpCurrent = 40;
let filter2DpCurrent = 45;
let tankLevelCurrent = 65;
let paused           = false;
let intervalId       = null;

// ─── Estado de escenario activo ────────────────────────────────────────────────

/** @type {{ name: string, expiresAt: number } | null} */
let activeScenario = null;

function setScenario(name, durationMs) {
  if (name === 'reset') {
    activeScenario = null;
    // Resetear estados internos para recuperación limpia
    filter1DpCurrent = 40;
    tankLevelCurrent = 65;
    self.postMessage({ type: 'scenario_update', scenario: null });
    return;
  }

  const expiresAt = Date.now() + durationMs;
  activeScenario = { name, expiresAt };
  self.postMessage({ type: 'scenario_update', scenario: { name, expiresAt, durationMs } });
}

function checkScenarioExpiry() {
  if (!activeScenario) return;
  if (Date.now() >= activeScenario.expiresAt) {
    activeScenario = null;
    // Recuperación gradual — resetear estados internos
    filter1DpCurrent = Math.min(filter1DpCurrent, 80);
    tankLevelCurrent = Math.max(tankLevelCurrent, 40);
    self.postMessage({ type: 'scenario_update', scenario: null });
  }
}

// ─── Generación de snapshot ────────────────────────────────────────────────────

function generateSnapshot() {
  checkScenarioExpiry();

  const readings = {};
  const scenario = activeScenario?.name ?? null;

  try {
    // 1. inlet_flow
    let inletFlow = 120 + noise('inlet_flow', 30, 0.025);

    // Escenario: chlorine_deficit necesita caudal alto
    if (scenario === 'chlorine_deficit') {
      inletFlow = 200 + noise('inlet_flow', 10, 0.05);
    }

    inletFlow = Math.max(20, Math.min(260, inletFlow));
    readings.inlet_flow = parseFloat(inletFlow.toFixed(1));

    // 2. raw_turbidity
    const rawTurb = Math.max(0.5, Math.min(60,
      3.0 + (inletFlow / 200) * 3.0 + noise('raw_turbidity', 2.0, 0.04)
    ));
    readings.raw_turbidity = parseFloat(rawTurb.toFixed(2));

    // 3. coag_ph
    let coagPh = 7.0 + noise('coag_ph', 0.6, 0.015);
    if (scenario === 'ph_anomaly') {
      coagPh = 5.8 + noise('coag_ph_sc', 0.2, 0.03); // fuera de rango warning (<6.2)
    }
    coagPh = Math.max(5.5, Math.min(8.5, coagPh));
    readings.coag_ph = parseFloat(coagPh.toFixed(2));

    // 4. filter_1_dp
    if (scenario === 'filter_1_clog') {
      // Forzar DP alto progresivo hasta 185 mbar
      filter1DpCurrent = Math.min(filter1DpCurrent + 2, 185);
    } else if (scenario === 'filter_1_critical') {
      // Forzar DP muy alto hasta 215 mbar
      filter1DpCurrent = Math.min(filter1DpCurrent + 3, 215);
    } else {
      // Comportamiento normal con colmatación progresiva
      filter1DpCurrent = filter1DpCurrent + 0.12 + noise('filter_1_dp_drift', 0.08, 0.02);
      if (filter1DpCurrent > 210) filter1DpCurrent = 20 + Math.random() * 10;
    }
    const filter1Dp = Math.max(15, Math.min(230,
      filter1DpCurrent + noise('filter_1_dp', 3, 0.05)
    ));
    readings.filter_1_dp = parseFloat(filter1Dp.toFixed(1));

    // 5. filter_2_dp — siempre comportamiento normal
    filter2DpCurrent = filter2DpCurrent + 0.09 + noise('filter_2_dp_drift', 0.06, 0.018);
    if (filter2DpCurrent > 205) filter2DpCurrent = 22 + Math.random() * 10;
    const filter2Dp = Math.max(15, Math.min(230,
      filter2DpCurrent + noise('filter_2_dp', 3, 0.048)
    ));
    readings.filter_2_dp = parseFloat(filter2Dp.toFixed(1));

    // 6. filtered_turbidity — correlaciona con filter_1_dp
    const filteredTurb = Math.max(0.05, Math.min(1.5,
      0.15 + (filter1Dp / 210) * 0.9 + noise('filtered_turbidity', 0.05, 0.06)
    ));
    readings.filtered_turbidity = parseFloat(filteredTurb.toFixed(3));

    // 7. chlorine_dose
    let chlorineDose;
    if (scenario === 'chlorine_deficit') {
      // Dosis fija baja — no escala con el caudal alto → déficit
      chlorineDose = 0.4 + noise('chlorine_dose_sc', 0.05, 0.04);
    } else {
      chlorineDose = 1.0 * (inletFlow / 150) + noise('chlorine_dose', 0.3, 0.035);
    }
    chlorineDose = Math.max(0.3, Math.min(4.5, chlorineDose));
    readings.chlorine_dose = parseFloat(chlorineDose.toFixed(2));

    // 8. residual_chlorine
    const residualCl = Math.max(0.05, Math.min(1.8,
      chlorineDose * 0.28 + noise('residual_chlorine', 0.08, 0.04)
    ));
    readings.residual_chlorine = parseFloat(residualCl.toFixed(3));

    // 9. tank_level
    if (scenario === 'low_tank') {
      // Caída gradual hasta ~18%
      tankLevelCurrent = Math.max(tankLevelCurrent - 0.5, 18);
    } else {
      // Recuperación gradual si venimos de low_tank
      tankLevelCurrent = Math.min(tankLevelCurrent + 0.1, 65);
      tankLevelCurrent = Math.max(15, Math.min(98,
        tankLevelCurrent + noise('tank_level', 1, 0.008)
      ));
    }
    readings.tank_level = parseFloat(tankLevelCurrent.toFixed(1));

    // 10. outlet_pressure
    const outletPressure = Math.max(1.5, Math.min(7.5,
      4.0 + (tankLevelCurrent / 100) * 1.0 + noise('outlet_pressure', 0.5, 0.03)
    ));
    readings.outlet_pressure = parseFloat(outletPressure.toFixed(2));

    Object.assign(lastValid, readings);

  } catch (err) {
    console.warn('sensor.worker: error generando snapshot, usando últimos válidos', err);
    Object.keys(lastValid).forEach(key => {
      if (!(key in readings)) readings[key] = lastValid[key];
    });
  }

  // Garantía: todas las claves presentes
  Object.keys(lastValid).forEach(key => {
    if (!(key in readings) || !Number.isFinite(readings[key])) {
      readings[key] = lastValid[key];
    }
  });

  return { timestamp: Date.now(), readings };
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

function startLoop() {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    if (paused) return;
    self.postMessage(generateSnapshot());
  }, 500);
}

function stopLoop() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
}

// ─── Comandos ─────────────────────────────────────────────────────────────────

self.addEventListener('message', ({ data }) => {
  switch (data?.cmd) {
    case 'start':
      paused = false;
      startLoop();
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      if (intervalId === null) startLoop();
      break;
    case 'stop':
      stopLoop();
      break;
    case 'scenario':
      setScenario(data.name, data.durationMs ?? 30_000);
      break;
    default:
      if (import.meta.env?.DEV) {
        console.warn('sensor.worker: comando desconocido', data);
      }
  }
});

startLoop();