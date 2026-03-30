/**
 * MQTTPanel.js — Panel MQTT del sidebar.
 *
 * Ahora es solo un indicador de estado — no gestiona la conexión.
 * Todo el flujo de conectar/desconectar/configurar está en ConfigModal.
 *
 * El botón "Configure & Connect →" abre ConfigModal directamente.
 * El usuario siempre sabe dónde está y qué hacer a continuación.
 *
 * Mobile: no hay cambios en la lógica — el CSS responsive se encarga
 * de reposicionar el panel. El botón sigue funcionando igual.
 */

import EventBus       from '../core/EventBus.js';
import { EVENTS }     from '../core/events.js';
import { loadConfig } from './ConfigModal.js';
import ConfigModal    from './ConfigModal.js';

const MQTTPanel = {
  _handlers: [],

  init() {
    // Rellenar el panel con la config guardada al arrancar
    this._refreshDisplay();

    // ── Botón principal — siempre abre el ConfigModal ─────────────────────
    const btn = document.getElementById('mqtt-connect-btn');
    if (btn) {
      btn.addEventListener('click', () => ConfigModal.open());
    }

    // ── Actualizar el indicador de estado según eventos MQTT ──────────────
    const onConnecting = ({ brokerUrl }) => {
      this._setSource('connecting', 'Connecting…');
      const brokerVal = document.getElementById('mqtt-broker-val');
      if (brokerVal) brokerVal.textContent = this._host(brokerUrl);
    };

    const onConnected = ({ brokerUrl }) => {
      this._setSource('connected', '● MQTT Live');
      const brokerVal = document.getElementById('mqtt-broker-val');
      if (brokerVal) brokerVal.textContent = this._host(brokerUrl);
      // Cambiar el botón del panel a "Disconnect" visual
      const btn = document.getElementById('mqtt-connect-btn');
      if (btn) {
        btn.textContent = 'Connected — click to manage →';
        btn.classList.add('is-connected');
      }
    };

    const onError = () => {
      this._setSource('simulator', '● Simulator');
      const btn = document.getElementById('mqtt-connect-btn');
      if (btn) {
        btn.textContent = 'Configure & Connect →';
        btn.classList.remove('is-connected');
      }
    };

    const onDisconnected = () => {
      this._setSource('simulator', '● Simulator');
      this._refreshDisplay();
      const btn = document.getElementById('mqtt-connect-btn');
      if (btn) {
        btn.textContent = 'Configure & Connect →';
        btn.classList.remove('is-connected');
      }
    };

    EventBus.on(EVENTS.MQTT_CONNECTING,   onConnecting);
    EventBus.on(EVENTS.MQTT_CONNECTED,    onConnected);
    EventBus.on(EVENTS.MQTT_ERROR,        onError);
    EventBus.on(EVENTS.MQTT_DISCONNECTED, onDisconnected);

    this._handlers = [
      [EVENTS.MQTT_CONNECTING,   onConnecting],
      [EVENTS.MQTT_CONNECTED,    onConnected],
      [EVENTS.MQTT_ERROR,        onError],
      [EVENTS.MQTT_DISCONNECTED, onDisconnected],
    ];
  },

  _setSource(state, text) {
    const sourceVal = document.getElementById('mqtt-source-val');
    if (!sourceVal) return;
    const colors = {
      connecting: 'var(--blue)',
      connected:  'var(--green)',
      simulator:  'var(--text1)',
    };
    sourceVal.textContent = text;
    sourceVal.style.color = colors[state] ?? 'var(--text1)';
  },

  _refreshDisplay() {
    const cfg = loadConfig();
    const brokerVal = document.getElementById('mqtt-broker-val');
    const plantVal  = document.getElementById('mqtt-plant-val');
    if (brokerVal) brokerVal.textContent = cfg.brokerUrl ? this._host(cfg.brokerUrl) : '—';
    if (plantVal)  plantVal.textContent  = cfg.plantId   || 'plant-01';
  },

  _host(url) {
    try { return new URL(url).hostname; } catch { return url; }
  },

  destroy() {
    this._handlers.forEach(([e, fn]) => EventBus.off(e, fn));
    this._handlers = [];
  },
};

export default MQTTPanel;