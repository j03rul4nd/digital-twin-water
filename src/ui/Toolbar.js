/**
 * Toolbar.js — Topbar del dashboard.
 *
 * Escucha los 4 eventos MQTT para actualizar el dot de fuente y el texto de estado.
 * Gestiona el alert chip: contador interno, opacity 0/1 (nunca display: none).
 * Sincroniza el Plant ID entre el input del topbar y el valor mostrado en el panel MQTT.
 *
 * Inicializado en el paso 4 de init() en main.js — antes del Worker,
 * para que los eventos MQTT_* se capturen desde el arranque.
 */

import EventBus           from '../core/EventBus.js';
import { EVENTS }         from '../core/events.js';
import DataSourceManager  from '../core/DataSourceManager.js';

// ─── Estados de fuente de datos → config visual ───────────────────────────────
// Separados por origen para máxima claridad de modo activo en la UI.
const SOURCE_STATES = {
  // Modos de DataSourceManager
  none: {
    dotColor:  'var(--text2)',
    dotPulse:  false,
    text:      'No data source',
    textColor: 'var(--text2)',
  },
  simulation: {
    dotColor:  'var(--amber)',
    dotPulse:  false,
    text:      'Simulation',
    textColor: 'var(--amber)',
  },
  mqtt: {
    dotColor:  'var(--green)',
    dotPulse:  false,
    text:      'MQTT Live',
    textColor: 'var(--green)',
  },
  // Estados transitorios MQTT
  connecting: {
    dotColor:  'var(--blue)',
    dotPulse:  true,
    text:      'Connecting…',
    textColor: 'var(--blue)',
  },
  error: {
    dotColor:  'var(--red)',
    dotPulse:  false,
    text:      'Connection error',
    textColor: 'var(--red)',
  },
};

const Toolbar = {
  /** @type {number} — contador interno de alertas activas */
  _alertCount: 0,

  /** @type {Function[]} — handlers guardados para poder hacer off() */
  _handlers: [],

  /**
   * Registra todos los listeners.
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    // ── Eventos de fuente de datos (DataSourceManager) ────────────────────
    const onSourceChanged = ({ mode }) => {
      this._setSourceState(mode);
      this._updateSimBtn(mode);
    };

    // ── Eventos transitorios MQTT (connecting / error) ────────────────────
    const onConnecting = () => this._setSourceState('connecting');
    const onError      = () => this._setSourceState('error');

    // ── Resetear contador de alertas al limpiar ───────────────────────────
    const onClearing = () => this.resetAlertCount();

    // ── Alertas ───────────────────────────────────────────────────────────
    const onAlert = (alert) => this._handleAlert(alert);

    EventBus.on(EVENTS.DATA_SOURCE_CHANGED,  onSourceChanged);
    EventBus.on(EVENTS.DATA_SOURCE_CLEARING, onClearing);
    EventBus.on(EVENTS.MQTT_CONNECTING,      onConnecting);
    EventBus.on(EVENTS.MQTT_ERROR,           onError);
    EventBus.on(EVENTS.RULE_TRIGGERED,       onAlert);

    this._handlers = [
      [EVENTS.DATA_SOURCE_CHANGED,  onSourceChanged],
      [EVENTS.DATA_SOURCE_CLEARING, onClearing],
      [EVENTS.MQTT_CONNECTING,      onConnecting],
      [EVENTS.MQTT_ERROR,           onError],
      [EVENTS.RULE_TRIGGERED,       onAlert],
    ];

    // ── Estado inicial — ninguna fuente activa ────────────────────────────
    this._setSourceState('none');
    this._updateSimBtn('none');

    // ── Sincronizar Plant ID ──────────────────────────────────────────────
    const input = document.getElementById('plant-id-input');
    const mqttPlantVal = document.getElementById('mqtt-plant-val');

    if (input && mqttPlantVal) {
      input.addEventListener('input', () => {
        mqttPlantVal.textContent = input.value || 'plant-01';
      });
    }

    // ── Botón Simulation toggle ───────────────────────────────────────────
    const simBtn = document.getElementById('btn-simulation');
    if (simBtn) {
      simBtn.addEventListener('click', () => {
        const mode = DataSourceManager.getMode();
        if (mode === 'simulation') {
          DataSourceManager.stopSimulation();
        } else if (mode === 'none') {
          DataSourceManager.startSimulation();
        }
        // Si mode === 'mqtt': el botón está disabled, no hace nada
      });
    }

    // ── Botón Docs ────────────────────────────────────────────────────────
    const docsBtn = document.getElementById('btn-docs');
    if (docsBtn) {
      docsBtn.addEventListener('click', () => {
        window.open('https://github.com', '_blank');
      });
    }

    // ── Botón Export CSV ──────────────────────────────────────────────────
    // La lógica real se conecta en Fase 4 con DataExporter.
    // Aquí solo se emite el evento para que cualquier listener lo capture.
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        EventBus.emit(EVENTS.EXPORT_STARTED, { format: 'csv' });
      });
    }
  },

  /**
   * Actualiza el dot de fuente y el texto de estado.
   * @param {'none'|'simulation'|'mqtt'|'connecting'|'error'} state
   */
  _setSourceState(state) {
    const config = SOURCE_STATES[state] ?? SOURCE_STATES.none;

    const dot  = document.getElementById('source-dot');
    const text = document.getElementById('source-text');

    if (dot) {
      dot.style.background = config.dotColor;
      if (config.dotPulse) {
        dot.classList.add('pulse');
      } else {
        dot.classList.remove('pulse');
      }
    }

    if (text) {
      text.textContent = config.text;
      text.style.color = config.textColor;
    }
  },

  /**
   * Actualiza el botón de simulación según el modo activo.
   * @param {'none'|'simulation'|'mqtt'} mode
   */
  _updateSimBtn(mode) {
    const btn = document.getElementById('btn-simulation');
    if (!btn) return;

    if (mode === 'simulation') {
      btn.textContent = '⏹ Stop Sim';
      btn.classList.add('is-active');
      btn.title = 'Stop simulation and clear all simulated data';
    } else if (mode === 'mqtt') {
      btn.textContent = '▶ Simulation';
      btn.classList.remove('is-active');
      btn.disabled = true;
      btn.title = 'Disconnect from MQTT first to use simulation';
    } else {
      btn.textContent = '▶ Simulation';
      btn.classList.remove('is-active');
      btn.disabled = false;
      btn.title = 'Start simulation with synthetic sensor data';
    }
  },

  /**
   * Resetea el contador de alertas del toolbar.
   * Llamado automáticamente al recibir DATA_SOURCE_CLEARING.
   */
  resetAlertCount() {
    this._alertCount = 0;
    this._updateAlertChip();
  },

  /**
   * Gestiona el alert chip cuando llega un RULE_TRIGGERED.
   * @param {{ active: boolean, severity: 'warning'|'danger' }} alert
   */
  _handleAlert(alert) {
    if (alert.active) {
      this._alertCount++;
    } else {
      this._alertCount = Math.max(0, this._alertCount - 1);
    }

    this._updateAlertChip();
  },

  /**
   * Actualiza la visibilidad y el texto del alert chip.
   * Usa opacity 0/1 — nunca display: none, para que la transición funcione.
   */
  _updateAlertChip() {
    const chip = document.getElementById('alert-chip');
    if (!chip) return;

    if (this._alertCount === 0) {
      chip.classList.remove('visible', 'is-warning');
    } else {
      chip.textContent = `${this._alertCount} alert${this._alertCount === 1 ? '' : 's'} active`;
      chip.classList.add('visible');

      // El chip se pone en amber solo si no hay alertas danger activas.
      // Por simplicidad, el Toolbar no distingue severidades en el contador —
      // eso lo hace AlertPanel con los colores de acento individuales.
      // El chip siempre es rojo cuando hay alertas (estado más severo visible).
      chip.classList.remove('is-warning');
    }
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    this._handlers.forEach(([event, handler]) => {
      EventBus.off(event, handler);
    });
    this._handlers    = [];
    this._alertCount  = 0;
  },
};

export default Toolbar;