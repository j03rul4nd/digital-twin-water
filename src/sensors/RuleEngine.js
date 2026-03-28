/**
 * RuleEngine.js — Motor de reglas determinista.
 *
 * Evalúa snapshots completos en cada tick y gestiona el ciclo de vida
 * de las alertas (activo / resuelto). Cero latencia, cero descarga.
 *
 * Para añadir una regla en un fork: añadir un objeto al array RULES[].
 * No tocar la lógica de evaluación ni el ciclo de vida.
 *
 * Contrato de salida (Decisión 6) — shape del objeto alert:
 * {
 *   id:        string,                  — único, para deduplicar
 *   severity:  'warning' | 'danger',
 *   sensorIds: string[],                — qué meshes iluminar en la escena
 *   message:   string,
 *   timestamp: number,
 *   active:    boolean                  — false cuando la condición se resuelve
 * }
 *
 * Un único evento RULE_TRIGGERED con active: true o false.
 * AlertPanel y AlertSystem solo necesitan un listener.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import SensorState from './SensorState.js';

// ─── Reglas ───────────────────────────────────────────────────────────────────
// Para añadir una regla nueva, añadir un objeto aquí.
// condition(readings) recibe el objeto completo del snapshot.
// Devuelve true si la alerta debe estar activa.

const RULES = [
  // ── Filtro #1 colmatado ────────────────────────────────────────────────────
  // DP alta + turbidez filtrada alta = el lecho filtrante está saturado
  {
    id:        'filter_1_clogged',
    severity:  'warning',
    sensorIds: ['filter_1_dp', 'filtered_turbidity'],
    message:   'Filter #1 may be clogged — high DP with turbidity breakthrough',
    condition: (r) => r.filter_1_dp > 150 && r.filtered_turbidity > 0.5,
  },

  // ── Filtro #1 en danger ────────────────────────────────────────────────────
  // DP muy alta = riesgo de rotura del lecho o daño estructural
  {
    id:        'filter_1_critical',
    severity:  'danger',
    sensorIds: ['filter_1_dp'],
    message:   'Filter #1 critical — differential pressure exceeds safe limit',
    condition: (r) => r.filter_1_dp > 200,
  },

  // ── Filtro #2 colmatado ────────────────────────────────────────────────────
  {
    id:        'filter_2_clogged',
    severity:  'warning',
    sensorIds: ['filter_2_dp', 'filtered_turbidity'],
    message:   'Filter #2 may be clogged — high DP detected',
    condition: (r) => r.filter_2_dp > 150,
  },

  // ── Filtro #2 en danger ────────────────────────────────────────────────────
  {
    id:        'filter_2_critical',
    severity:  'danger',
    sensorIds: ['filter_2_dp'],
    message:   'Filter #2 critical — differential pressure exceeds safe limit',
    condition: (r) => r.filter_2_dp > 200,
  },

  // ── Déficit de desinfección ────────────────────────────────────────────────
  // La dosis de cloro no escala con el caudal → riesgo microbiológico
  {
    id:        'chlorine_deficit',
    severity:  'danger',
    sensorIds: ['inlet_flow', 'chlorine_dose'],
    message:   'Chlorine dose not scaling with flow — disinfection deficit risk',
    condition: (r) => {
      const expectedDose = 1.0 * (r.inlet_flow / 150);
      return r.chlorine_dose < expectedDose * 0.7;
    },
  },

  // ── Cloro residual bajo ────────────────────────────────────────────────────
  // El cloro en distribución ha caído por debajo del mínimo regulatorio
  {
    id:        'low_residual_chlorine',
    severity:  'danger',
    sensorIds: ['residual_chlorine'],
    message:   'Residual chlorine below regulatory minimum — distribution risk',
    condition: (r) => r.residual_chlorine < 0.1,
  },

  // ── Turbidez filtrada alta ─────────────────────────────────────────────────
  // El agua post-filtración no cumple el estándar de calidad
  {
    id:        'high_filtered_turbidity',
    severity:  'warning',
    sensorIds: ['filtered_turbidity'],
    message:   'Filtered turbidity above threshold — check filter media condition',
    condition: (r) => r.filtered_turbidity > 0.5,
  },

  // ── Nivel de clearwell bajo ────────────────────────────────────────────────
  // El depósito de agua tratada está casi vacío
  {
    id:        'low_tank_level',
    severity:  'warning',
    sensorIds: ['tank_level'],
    message:   'Clearwell tank level low — check inlet flow and demand balance',
    condition: (r) => r.tank_level < 25,
  },

  // ── Nivel de clearwell crítico ─────────────────────────────────────────────
  {
    id:        'critical_tank_level',
    severity:  'danger',
    sensorIds: ['tank_level'],
    message:   'Clearwell tank critically low — risk of supply interruption',
    condition: (r) => r.tank_level < 15,
  },

  // ── pH de coagulación fuera de rango ──────────────────────────────────────
  // El pH afecta directamente a la eficacia de la coagulación
  {
    id:        'coag_ph_out_of_range',
    severity:  'warning',
    sensorIds: ['coag_ph'],
    message:   'Coagulation pH outside optimal range — coagulant efficiency reduced',
    condition: (r) => r.coag_ph < 6.2 || r.coag_ph > 7.8,
  },

  // ── Presión de distribución baja ──────────────────────────────────────────
  {
    id:        'low_outlet_pressure',
    severity:  'warning',
    sensorIds: ['outlet_pressure'],
    message:   'Distribution pressure low — check pump station status',
    condition: (r) => r.outlet_pressure < 2.5,
  },

  // ── Caudal de entrada anómalo ─────────────────────────────────────────────
  {
    id:        'inlet_flow_anomaly',
    severity:  'warning',
    sensorIds: ['inlet_flow'],
    message:   'Inlet flow outside normal range — check intake structure',
    condition: (r) => r.inlet_flow < 40 || r.inlet_flow > 220,
  },

  // ══ REGLAS DE TENDENCIA ════════════════════════════════════════════════════
  // Estas reglas usan SensorState.getTrend() para detectar patrones en el tiempo
  // en vez de evaluar solo el valor puntual del tick actual.
  // condition recibe (readings, state) donde state = SensorState.

  // ── Filter #1 DP subiendo rápido ──────────────────────────────────────────
  // Predice colmatación inminente antes de llegar al umbral de warning.
  // Dispara cuando la pendiente supera 0.8 mbar/s en los últimos 60 segundos.
  // Eso equivale a subir ~48 mbar en un minuto — señal de colmatación acelerada.
  {
    id:        'filter_1_dp_rising',
    severity:  'warning',
    sensorIds: ['filter_1_dp'],
    message:   'Filter #1 DP rising fast — clogging predicted within minutes',
    condition: (r, state) => {
      // No disparar si ya está en zona de warning por valor absoluto
      if (r.filter_1_dp > 150) return false;
      const trend = state.getTrend('filter_1_dp', 60);
      if (!trend || trend.samples < 10) return false;
      return trend.slope > 0.8 && trend.direction === 'rising';
    },
  },

  // ── Tank level bajando de forma sostenida ─────────────────────────────────
  // Detecta vaciado progresivo del clearwell antes de llegar al umbral absoluto.
  // Dispara cuando el nivel lleva 90s bajando y ha perdido más de un 15% relativo.
  {
    id:        'tank_draining',
    severity:  'warning',
    sensorIds: ['tank_level'],
    message:   'Clearwell tank draining steadily — check demand vs inlet balance',
    condition: (r, state) => {
      // No disparar si ya está en warning por valor absoluto
      if (r.tank_level < 25) return false;
      const trend = state.getTrend('tank_level', 90);
      if (!trend || trend.samples < 15) return false;
      return trend.direction === 'falling' && trend.deltaRel < -0.15;
    },
  },

  // ── Caída brusca de caudal de entrada ─────────────────────────────────────
  // Una caída > 35% en 30 segundos indica problema en la toma o bomba de entrada.
  // Distinto de inlet_flow_anomaly que detecta valores fuera de rango absoluto.
  {
    id:        'inlet_flow_sudden_drop',
    severity:  'warning',
    sensorIds: ['inlet_flow'],
    message:   'Inlet flow dropped sharply — check intake pump and intake structure',
    condition: (r, state) => {
      // No disparar si el caudal ya está en rango anómalo absoluto
      if (r.inlet_flow < 40) return false;
      const trend = state.getTrend('inlet_flow', 30);
      if (!trend || trend.samples < 6) return false;
      // Caída > 35% respecto al valor inicial de la ventana
      return trend.direction === 'falling' && trend.deltaRel < -0.35;
    },
  },

  // ── Turbidez filtrada con tendencia al alza ────────────────────────────────
  // La turbidez post-filtración subiendo de forma sostenida indica
  // degradación progresiva del medio filtrante, incluso antes de superar el umbral.
  {
    id:        'filtered_turbidity_rising',
    severity:  'warning',
    sensorIds: ['filtered_turbidity'],
    message:   'Filtered turbidity trending up — filter media may be degrading',
    condition: (r, state) => {
      if (r.filtered_turbidity > 0.5) return false; // ya tiene alerta absoluta
      const trend = state.getTrend('filtered_turbidity', 120);
      if (!trend || trend.samples < 20) return false;
      return trend.direction === 'rising' && trend.deltaRel > 0.5;
    },
  },
];

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {Map<string, object>} alertId → alert object */
const activeAlerts = new Map();

/** @type {Function | null} */
let _sensorHandler = null;

// ─── Lógica de evaluación ─────────────────────────────────────────────────────

/**
 * Evalúa todas las reglas contra el snapshot recibido.
 * Gestiona el ciclo de vida: activa alertas nuevas, resuelve las que ya no aplican.
 * @param {{ timestamp: number, readings: Record<string, number> }} snapshot
 */
function evaluate(snapshot) {
  // No evaluar hasta que haya datos reales (Decisión 12)
  if (!SensorState.isReady()) return;

  const { readings, timestamp } = snapshot;

  RULES.forEach(rule => {
    let triggered = false;
    try {
      // Las reglas de tendencia reciben (readings, SensorState) como argumentos.
      // Las reglas simples solo usan el primero — el segundo es ignorado.
      triggered = rule.condition(readings, SensorState);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`RuleEngine: error evaluando regla "${rule.id}"`, err);
      }
      return; // si la condición lanza, ignorar esta regla en este tick
    }

    if (triggered && !activeAlerts.has(rule.id)) {
      // Alerta nueva — activar
      const alert = {
        id:        rule.id,
        severity:  rule.severity,
        sensorIds: rule.sensorIds,
        message:   rule.message,
        timestamp,
        active:    true,
      };
      activeAlerts.set(rule.id, alert);
      EventBus.emit(EVENTS.RULE_TRIGGERED, alert);
    }

    if (!triggered && activeAlerts.has(rule.id)) {
      // Alerta resuelta — desactivar
      const resolved = {
        ...activeAlerts.get(rule.id),
        active:    false,
        timestamp,
      };
      activeAlerts.delete(rule.id);
      EventBus.emit(EVENTS.RULE_TRIGGERED, resolved);
    }
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

const RuleEngine = {
  /**
   * Registra el listener de SENSOR_UPDATE.
   * Llamar en el paso 3 de init() en main.js.
   */
  init() {
    _sensorHandler = (snapshot) => evaluate(snapshot);
    EventBus.on(EVENTS.SENSOR_UPDATE, _sensorHandler);
  },

  /**
   * Devuelve una copia del array de alertas activas.
   * Usado por AlertPanel.init() para recuperar el estado existente
   * sin esperar al próximo tick (Decisión 7).
   * @returns {object[]}
   */
  getActiveAlerts() {
    return [...activeAlerts.values()];
  },

  /**
   * Limpia todas las alertas activas.
   * Llamar desde main.js junto a SensorState.reset() al cambiar de fuente.
   */
  clearAlerts() {
    // Emitir active: false para cada alerta activa antes de limpiar
    // para que AlertPanel y AlertSystem actualicen su estado visual
    activeAlerts.forEach((alert) => {
      EventBus.emit(EVENTS.RULE_TRIGGERED, {
        ...alert,
        active: false,
        timestamp: Date.now(),
      });
    });
    activeAlerts.clear();
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (_sensorHandler) {
      EventBus.off(EVENTS.SENSOR_UPDATE, _sensorHandler);
      _sensorHandler = null;
    }
    activeAlerts.clear();
  },
};

export default RuleEngine;