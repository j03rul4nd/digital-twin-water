/**
 * MQTTPanel.js — Lógica del panel MQTT (sub-panel derecho central).
 *
 * Gestiona el botón "Connect real MQTT →" y sus estados:
 *   idle        → "Connect real MQTT →"
 *   connecting  → "Connecting…" + cursor wait + disabled
 *   connected   → "Disconnect" + fondo rojo
 *   error       → "Retry →" + mensaje de error visible
 *
 * Escucha los 4 eventos MQTT para actualizar el UI del panel.
 * Delega la conexión real a MQTTAdapter.
 *
 * Inicializado en el paso 4 de init() en main.js.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import MQTTAdapter from '../sensors/MQTTAdapter.js';

const MQTTPanel = {
  /** @type {Function[]} */
  _handlers: [],

  /**
   * Registra listeners y conecta el botón.
   */
  init() {
    const btn      = document.getElementById('mqtt-connect-btn');
    const errorMsg = document.getElementById('mqtt-error-msg');

    if (!btn) return;

    // ── Clic en el botón ──────────────────────────────────────────────────
    btn.addEventListener('click', async () => {
      if (MQTTAdapter.isConnected()) {
        // Desconectar
        await MQTTAdapter.disconnect();
      } else {
        // Conectar con la config del panel
        const brokerUrl = this._buildBrokerUrl();
        const plantId   = document.getElementById('plant-id-input')?.value ?? 'plant-01';
        MQTTAdapter.connect({ brokerUrl, plantId });
      }
    });

    // ── Eventos MQTT ──────────────────────────────────────────────────────
    const onConnecting = ({ brokerUrl }) => {
      btn.textContent = 'Connecting…';
      btn.disabled    = true;
      btn.classList.remove('is-connected');
      if (errorMsg) errorMsg.style.display = 'none';
      // Actualizar el valor del broker en el panel
      const brokerVal = document.getElementById('mqtt-broker-val');
      if (brokerVal) brokerVal.textContent = this._brokerHost(brokerUrl);
    };

    const onConnected = () => {
      btn.textContent = 'Disconnect';
      btn.disabled    = false;
      btn.classList.add('is-connected');
      if (errorMsg) errorMsg.style.display = 'none';
      // Actualizar el indicador de fuente en el panel MQTT
      const sourceVal = document.getElementById('mqtt-source-val');
      if (sourceVal) {
        sourceVal.textContent = '● MQTT';
        sourceVal.style.color = 'var(--green)';
      }
    };

    const onError = ({ reason }) => {
      btn.textContent = 'Retry →';
      btn.disabled    = false;
      btn.classList.remove('is-connected');
      if (errorMsg) {
        errorMsg.textContent  = reason ?? 'Connection failed';
        errorMsg.style.display = 'block';
      }
      // Volver al indicador de simulador
      const sourceVal = document.getElementById('mqtt-source-val');
      if (sourceVal) {
        sourceVal.textContent = '● Simulator';
        sourceVal.style.color = '';
      }
    };

    const onDisconnected = ({ clean }) => {
      btn.textContent = 'Connect real MQTT →';
      btn.disabled    = false;
      btn.classList.remove('is-connected');
      if (errorMsg) errorMsg.style.display = 'none';
      const sourceVal = document.getElementById('mqtt-source-val');
      if (sourceVal) {
        sourceVal.textContent = '● Simulator';
        sourceVal.style.color = '';
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

  /**
   * Construye la URL del broker WebSocket.
   * Por defecto usa broker.emqx.io:8083 (ws no seguro).
   * Para wss:// cambiar el puerto a 8084.
   * @returns {string}
   */
  _buildBrokerUrl() {
    // En el MVP usamos la URL por defecto del broker de demo.
    // En una futura versión, leer de un input en el panel.
    return 'ws://broker.emqx.io:8083/mqtt';
  },

  /**
   * Extrae el hostname de una URL para mostrar en el panel.
   * @param {string} url
   * @returns {string}
   */
  _brokerHost(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  },

  /**
   * Limpieza.
   */
  destroy() {
    this._handlers.forEach(([event, handler]) => {
      EventBus.off(event, handler);
    });
    this._handlers = [];
  },
};

export default MQTTPanel;