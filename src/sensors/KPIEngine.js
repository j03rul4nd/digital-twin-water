/**
 * KPIEngine.js — Motor de KPIs de proceso.
 *
 * Calcula métricas derivadas sobre SensorState.history cada 5 segundos.
 * Emite EVENTS.KPIS_UPDATED con el objeto KPI completo.
 *
 * KPIs calculados:
 *   throughput         — m³ tratados estimados en la sesión actual
 *   timeInWarning      — % del tiempo en estado warning (cualquier sensor)
 *   timeInDanger       — % del tiempo en estado danger (cualquier sensor)
 *   backwashCount      — número de retrolavados detectados (resets de filter_1_dp)
 *   chlorinationEff    — % de ticks con cloro residual en rango normal
 *   avgInletFlow       — caudal medio en m³/h durante la sesión
 *   sessionDuration    — duración de la sesión en segundos
 *   alertsTriggered    — número de alertas activadas en la sesión
 *
 * Los KPIs se recalculan cada UPDATE_INTERVAL_MS sobre el buffer completo.
 * Con 360 snapshots × 500ms = 3 minutos de ventana máxima.
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import SensorState from './SensorState.js';
import { SENSORS } from './SensorConfig.js';
import { getSensorState } from '../scene/ColorMapper.js';

const UPDATE_INTERVAL_MS = 5_000; // recalcular cada 5 segundos

const KPIEngine = {
  _timer:         null,
  _backwashCount: 0,
  _lastFilter1Dp: null,
  _alertCount:    0,
  _sessionStart:  null,
  _handler:       null,

  init() {
    this._sessionStart = Date.now();

    // Contar alertas activadas en la sesión
    this._handler = (alert) => {
      if (alert.active) this._alertCount++;
    };
    EventBus.on(EVENTS.RULE_TRIGGERED, this._handler);

    // Calcular y emitir KPIs periódicamente
    this._timer = setInterval(() => this._calculate(), UPDATE_INTERVAL_MS);

    // Primera emisión inmediata tras 1s (cuando ya hay algo de historia)
    setTimeout(() => this._calculate(), 1000);
  },

  _calculate() {
    if (!SensorState.isReady()) return;

    const history = SensorState.history;
    if (history.length < 2) return;

    const n = history.length;

    // ── Duración de la sesión ──────────────────────────────────────────────
    const sessionDuration = Math.floor((Date.now() - this._sessionStart) / 1000);

    // ── Caudal medio ──────────────────────────────────────────────────────
    const flows = history.map(s => s.readings.inlet_flow).filter(Number.isFinite);
    const avgInletFlow = flows.length > 0
      ? parseFloat((flows.reduce((a, b) => a + b, 0) / flows.length).toFixed(1))
      : 0;

    // ── Throughput estimado ────────────────────────────────────────────────
    // m³/h × horas = m³
    // Cada snapshot = 500ms = 500/3600000 horas
    const hoursPerSnapshot = 0.5 / 3600;
    const throughput = parseFloat(
      (flows.reduce((a, b) => a + b, 0) * hoursPerSnapshot).toFixed(1)
    );

    // ── Tiempo en warning / danger ─────────────────────────────────────────
    let warningTicks = 0;
    let dangerTicks  = 0;

    history.forEach(snapshot => {
      let hasWarning = false;
      let hasDanger  = false;
      SENSORS.forEach(sensor => {
        const value = snapshot.readings[sensor.id];
        if (!Number.isFinite(value)) return;
        const state = getSensorState(sensor.id, value);
        if (state === 'danger')  hasDanger  = true;
        if (state === 'warning') hasWarning = true;
      });
      if (hasDanger)       dangerTicks++;
      else if (hasWarning) warningTicks++;
    });

    const timeInWarning = parseFloat(((warningTicks / n) * 100).toFixed(1));
    const timeInDanger  = parseFloat(((dangerTicks  / n) * 100).toFixed(1));
    const timeNormal    = parseFloat((100 - timeInWarning - timeInDanger).toFixed(1));

    // ── Retrolavados detectados ────────────────────────────────────────────
    // Un retrolavado ocurre cuando filter_1_dp cae más de 100 mbar en un tick
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].readings.filter_1_dp;
      const curr = history[i].readings.filter_1_dp;
      if (Number.isFinite(prev) && Number.isFinite(curr)) {
        if (prev - curr > 80) this._backwashCount++;
      }
    }
    // Evitar doble conteo — resetear y recalcular desde cero cada vez
    // (usamos una copia del conteo para no acumular entre llamadas)
    let backwashCount = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].readings.filter_1_dp;
      const curr = history[i].readings.filter_1_dp;
      if (Number.isFinite(prev) && Number.isFinite(curr)) {
        if (prev - curr > 80) backwashCount++;
      }
    }

    // ── Eficiencia de cloración ────────────────────────────────────────────
    // % de ticks donde residual_chlorine está en rango normal
    const chlorineConfig = SENSORS.find(s => s.id === 'residual_chlorine');
    let chlorineOkTicks = 0;
    let chlorineTotalTicks = 0;

    if (chlorineConfig) {
      history.forEach(snapshot => {
        const value = snapshot.readings.residual_chlorine;
        if (!Number.isFinite(value)) return;
        chlorineTotalTicks++;
        if (value >= chlorineConfig.normal.low && value <= chlorineConfig.normal.high) {
          chlorineOkTicks++;
        }
      });
    }

    const chlorinationEff = chlorineTotalTicks > 0
      ? parseFloat(((chlorineOkTicks / chlorineTotalTicks) * 100).toFixed(1))
      : 100;

    // ── Consumo estimado de cloro ──────────────────────────────────────────
    // (dosis media × caudal medio) × horas = mg total → kg
    const doses = history.map(s => s.readings.chlorine_dose).filter(Number.isFinite);
    const avgDose = doses.length > 0
      ? doses.reduce((a, b) => a + b, 0) / doses.length
      : 0;
    // mg/L × m³/h × h × 1000 L/m³ = mg × (h) → ÷ 1e6 = kg
    const hoursTotal = (n * 0.5) / 3600;
    const chlorineKg = parseFloat(
      (avgDose * avgInletFlow * hoursTotal * 1000 / 1e6).toFixed(4)
    );

    // ── Emitir ────────────────────────────────────────────────────────────
    const kpis = {
      throughput,
      avgInletFlow,
      timeNormal,
      timeInWarning,
      timeInDanger,
      backwashCount,
      chlorinationEff,
      chlorineKg,
      alertsTriggered: this._alertCount,
      sessionDuration,
      samplesInWindow:  n,
      calculatedAt:     Date.now(),
    };

    EventBus.emit(EVENTS.KPIS_UPDATED, kpis);
  },

  /**
   * Devuelve los KPIs actuales sin esperar al próximo ciclo.
   * Usado por el MCP server para responder queries inmediatas.
   */
  getCurrent() {
    this._calculate();
    // La última emisión queda en el EventBus — devolvemos un cálculo síncrono
    if (!SensorState.isReady()) return null;
    const history = SensorState.history;
    if (history.length < 2) return null;

    const n = history.length;
    const flows = history.map(s => s.readings.inlet_flow).filter(Number.isFinite);
    const avgInletFlow = flows.length > 0
      ? parseFloat((flows.reduce((a, b) => a + b, 0) / flows.length).toFixed(1))
      : 0;
    const throughput = parseFloat(
      (flows.reduce((a, b) => a + b, 0) * (0.5 / 3600)).toFixed(1)
    );
    const sessionDuration = Math.floor((Date.now() - this._sessionStart) / 1000);

    let warningTicks = 0, dangerTicks = 0;
    history.forEach(snapshot => {
      let hasWarning = false, hasDanger = false;
      SENSORS.forEach(sensor => {
        const value = snapshot.readings[sensor.id];
        if (!Number.isFinite(value)) return;
        const state = getSensorState(sensor.id, value);
        if (state === 'danger')  hasDanger  = true;
        if (state === 'warning') hasWarning = true;
      });
      if (hasDanger)       dangerTicks++;
      else if (hasWarning) warningTicks++;
    });

    let backwashCount = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].readings.filter_1_dp;
      const curr = history[i].readings.filter_1_dp;
      if (Number.isFinite(prev) && Number.isFinite(curr) && prev - curr > 80) backwashCount++;
    }

    const chlorineConfig = SENSORS.find(s => s.id === 'residual_chlorine');
    let chlorineOkTicks = 0, chlorineTotalTicks = 0;
    if (chlorineConfig) {
      history.forEach(snapshot => {
        const value = snapshot.readings.residual_chlorine;
        if (!Number.isFinite(value)) return;
        chlorineTotalTicks++;
        if (value >= chlorineConfig.normal.low && value <= chlorineConfig.normal.high) chlorineOkTicks++;
      });
    }

    return {
      throughput,
      avgInletFlow,
      timeNormal:      parseFloat((100 - (warningTicks / n * 100) - (dangerTicks / n * 100)).toFixed(1)),
      timeInWarning:   parseFloat((warningTicks / n * 100).toFixed(1)),
      timeInDanger:    parseFloat((dangerTicks  / n * 100).toFixed(1)),
      backwashCount,
      chlorinationEff: chlorineTotalTicks > 0
        ? parseFloat((chlorineOkTicks / chlorineTotalTicks * 100).toFixed(1))
        : 100,
      alertsTriggered: this._alertCount,
      sessionDuration,
      samplesInWindow: n,
      calculatedAt:    Date.now(),
    };
  },

  destroy() {
    if (this._timer)   { clearInterval(this._timer); this._timer = null; }
    if (this._handler) { EventBus.off(EVENTS.RULE_TRIGGERED, this._handler); this._handler = null; }
  },
};

export default KPIEngine;