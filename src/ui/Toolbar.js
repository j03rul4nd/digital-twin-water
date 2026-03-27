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

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';

// ─── Estados MQTT → config visual ────────────────────────────────────────────
const MQTT_STATES = {
  simulator: {
    dotColor:  'var(--amber)',
    dotPulse:  false,
    text:      'Simulator',
    textColor: 'var(--text1)',
  },
  connecting: {
    dotColor:  'var(--blue)',
    dotPulse:  true,
    text:      'Connecting…',
    textColor: 'var(--blue)',
  },
  connected: {
    dotColor:  'var(--green)',
    dotPulse:  false,
    text:      'MQTT Connected',
    textColor: 'var(--text0)',
  },
  error: {
    dotColor:  'var(--red)',
    dotPulse:  false,
    text:      'Error',
    textColor: 'var(--red)',
  },
  disconnected: {
    dotColor:  'var(--amber)',
    dotPulse:  false,
    text:      'Simulator',
    textColor: 'var(--text1)',
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
    // ── Eventos MQTT ──────────────────────────────────────────────────────
    const onConnecting = () => this._setSourceState('connecting');
    const onConnected  = () => this._setSourceState('connected');
    const onError      = () => this._setSourceState('error');
    const onDisconn    = () => this._setSourceState('disconnected');
    const onAlert      = (alert) => this._handleAlert(alert);

    EventBus.on(EVENTS.MQTT_CONNECTING,   onConnecting);
    EventBus.on(EVENTS.MQTT_CONNECTED,    onConnected);
    EventBus.on(EVENTS.MQTT_ERROR,        onError);
    EventBus.on(EVENTS.MQTT_DISCONNECTED, onDisconn);
    EventBus.on(EVENTS.RULE_TRIGGERED,    onAlert);

    this._handlers = [
      [EVENTS.MQTT_CONNECTING,   onConnecting],
      [EVENTS.MQTT_CONNECTED,    onConnected],
      [EVENTS.MQTT_ERROR,        onError],
      [EVENTS.MQTT_DISCONNECTED, onDisconn],
      [EVENTS.RULE_TRIGGERED,    onAlert],
    ];

    // ── Estado inicial ────────────────────────────────────────────────────
    this._setSourceState('simulator');

    // ── Sincronizar Plant ID ──────────────────────────────────────────────
    const input = document.getElementById('plant-id-input');
    const mqttPlantVal = document.getElementById('mqtt-plant-val');

    if (input && mqttPlantVal) {
      input.addEventListener('input', () => {
        mqttPlantVal.textContent = input.value || 'plant-01';
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
   * Actualiza el dot de fuente y el texto de estado según el estado MQTT.
   * @param {'simulator'|'connecting'|'connected'|'error'|'disconnected'} state
   */
  _setSourceState(state) {
    const config = MQTT_STATES[state] ?? MQTT_STATES.simulator;

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
      text.textContent  = config.text;
      text.style.color  = config.textColor;
    }
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
    this._handlers = [];
    this._alertCount = 0;
  },
};

export default Toolbar;