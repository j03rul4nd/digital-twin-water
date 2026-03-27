/**
 * MQTTPanel.js — Panel MQTT del dashboard (sub-panel derecho central).
 *
 * Lee la configuración de localStorage via ConfigModal.loadConfig().
 * Ya no tiene credenciales hardcodeadas — el usuario las configura
 * desde el modal de settings (botón ⚙ en el topbar).
 *
 * Estados del botón:
 *   idle        → "Connect real MQTT →"
 *   connecting  → "Connecting…" + disabled
 *   connected   → "Disconnect" + fondo rojo
 *   error       → "Retry →" + mensaje de error
 */

import EventBus          from '../core/EventBus.js';
import { EVENTS }        from '../core/events.js';
import MQTTAdapter       from '../sensors/MQTTAdapter.js';
import { loadConfig }    from './ConfigModal.js';

const MQTTPanel = {
  _handlers: [],

  init() {
    const btn      = document.getElementById('mqtt-connect-btn');
    const errorMsg = document.getElementById('mqtt-error-msg');

    if (!btn) return;

    // Rellenar panel con la config guardada al arrancar
    this._refreshDisplay();

    // ── Clic en el botón ──────────────────────────────────────────────────
    btn.addEventListener('click', async () => {
      if (MQTTAdapter.isConnected()) {
        await MQTTAdapter.disconnect();
      } else {
        // Leer config actualizada de localStorage en el momento de conectar
        const cfg = loadConfig();
        if (!cfg.brokerUrl) {
          // Sin config — abrir el modal directamente
          document.getElementById('btn-settings')?.click();
          return;
        }
        MQTTAdapter.connect({
          brokerUrl: cfg.brokerUrl,
          plantId:   cfg.plantId,
          username:  cfg.username,
          password:  cfg.password,
        });
      }
    });

    // ── Eventos MQTT ──────────────────────────────────────────────────────
    const onConnecting = ({ brokerUrl }) => {
      btn.textContent = 'Connecting…';
      btn.disabled    = true;
      btn.classList.remove('is-connected');
      if (errorMsg) errorMsg.style.display = 'none';
      const brokerVal = document.getElementById('mqtt-broker-val');
      if (brokerVal) brokerVal.textContent = this._brokerHost(brokerUrl);
    };

    const onConnected = () => {
      btn.textContent = 'Disconnect';
      btn.disabled    = false;
      btn.classList.add('is-connected');
      if (errorMsg) errorMsg.style.display = 'none';
      const sourceVal = document.getElementById('mqtt-source-val');
      if (sourceVal) { sourceVal.textContent = '● MQTT'; sourceVal.style.color = 'var(--green)'; }
    };

    const onError = ({ reason }) => {
      btn.textContent = 'Retry →';
      btn.disabled    = false;
      btn.classList.remove('is-connected');
      if (errorMsg) { errorMsg.textContent = reason ?? 'Connection failed'; errorMsg.style.display = 'block'; }
      const sourceVal = document.getElementById('mqtt-source-val');
      if (sourceVal) { sourceVal.textContent = '● Simulator'; sourceVal.style.color = ''; }
    };

    const onDisconnected = () => {
      btn.textContent = 'Connect real MQTT →';
      btn.disabled    = false;
      btn.classList.remove('is-connected');
      if (errorMsg) errorMsg.style.display = 'none';
      const sourceVal = document.getElementById('mqtt-source-val');
      if (sourceVal) { sourceVal.textContent = '● Simulator'; sourceVal.style.color = ''; }
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
   * Rellena el panel con los valores actuales de localStorage.
   * Llamar tras guardar nueva config desde ConfigModal.
   */
  _refreshDisplay() {
    const cfg = loadConfig();
    const brokerVal = document.getElementById('mqtt-broker-val');
    const plantVal  = document.getElementById('mqtt-plant-val');
    if (brokerVal) brokerVal.textContent = cfg.brokerUrl ? this._brokerHost(cfg.brokerUrl) : '—';
    if (plantVal)  plantVal.textContent  = cfg.plantId   ?? 'plant-01';
  },

  _brokerHost(url) {
    try { return new URL(url).hostname; } catch { return url; }
  },

  destroy() {
    this._handlers.forEach(([event, handler]) => EventBus.off(event, handler));
    this._handlers = [];
  },
};

export default MQTTPanel;