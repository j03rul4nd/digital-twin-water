/**
 * ConfigModal.js — Modal de configuración del broker MQTT.
 *
 * Permite al usuario configurar la conexión sin tocar el código.
 * Persiste los valores en localStorage — sobrevive a recargas.
 *
 * Flujo:
 *   1. Usuario abre el modal con el botón ⚙ del topbar
 *   2. Rellena broker URL, usuario, contraseña y plant ID
 *   3. Pulsa "Test & Connect" — intenta conectar y muestra resultado
 *   4. Si conecta: guarda en localStorage, cierra el modal
 *   5. Si falla: muestra el error sin cerrar el modal
 *
 * Los valores guardados en localStorage son leídos por MQTTPanel
 * al cargar la página para pre-rellenar el panel de estado.
 *
 * Claves de localStorage:
 *   wtp_broker_url   — URL completa wss://...
 *   wtp_username     — usuario del broker
 *   wtp_password     — contraseña del broker
 *   wtp_plant_id     — plant ID (también sincronizado con el input del topbar)
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import MQTTAdapter from '../sensors/MQTTAdapter.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  brokerUrl: 'wss://9da7cd10c3c440aa9e8c2ac30e5a733b.s2.eu.hivemq.cloud:8884/mqtt',
  username:  '',
  password:  '',
  plantId:   'plant-01',
};

// ─── localStorage helpers ─────────────────────────────────────────────────────
export function loadConfig() {
  return {
    brokerUrl: localStorage.getItem('wtp_broker_url') ?? DEFAULTS.brokerUrl,
    username:  localStorage.getItem('wtp_username')   ?? DEFAULTS.username,
    password:  localStorage.getItem('wtp_password')   ?? DEFAULTS.password,
    plantId:   localStorage.getItem('wtp_plant_id')   ?? DEFAULTS.plantId,
  };
}

function saveConfig({ brokerUrl, username, password, plantId }) {
  localStorage.setItem('wtp_broker_url', brokerUrl);
  localStorage.setItem('wtp_username',   username);
  localStorage.setItem('wtp_password',   password);
  localStorage.setItem('wtp_plant_id',   plantId);
}

// ─── ConfigModal ──────────────────────────────────────────────────────────────
const ConfigModal = {
  /** @type {HTMLElement|null} */
  _overlay: null,

  /** @type {Function[]} — listeners MQTT para saber el resultado del test */
  _testHandlers: [],

  /**
   * Inicializa el modal: crea el DOM e inyecta en el body.
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    this._build();
    this._bindOpenButton();
  },

  /**
   * Abre el modal y rellena los campos con los valores guardados.
   */
  open() {
    const cfg = loadConfig();
    document.getElementById('cfg-broker').value   = cfg.brokerUrl;
    document.getElementById('cfg-username').value = cfg.username;
    document.getElementById('cfg-password').value = cfg.password;
    document.getElementById('cfg-plant').value    = cfg.plantId;

    this._setStatus('idle');
    this._overlay.classList.add('visible');
    document.getElementById('cfg-broker').focus();
  },

  /**
   * Cierra el modal.
   */
  close() {
    this._overlay.classList.remove('visible');
    this._clearTestHandlers();
  },

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'config-overlay';
    el.innerHTML = `
      <div id="config-modal" role="dialog" aria-modal="true" aria-labelledby="cfg-title">

        <div id="cfg-header">
          <span id="cfg-title">MQTT Configuration</span>
          <button id="cfg-close" aria-label="Close">✕</button>
        </div>

        <div id="cfg-body">

          <div class="cfg-field">
            <label class="cfg-label" for="cfg-broker">Broker URL</label>
            <input class="cfg-input" id="cfg-broker" type="text"
              placeholder="wss://your-broker:8884/mqtt"
              autocomplete="off" spellcheck="false" />
            <span class="cfg-hint">Use wss:// for secure WebSocket (required by most cloud brokers)</span>
          </div>

          <div class="cfg-row">
            <div class="cfg-field">
              <label class="cfg-label" for="cfg-username">Username</label>
              <input class="cfg-input" id="cfg-username" type="text"
                placeholder="your-username"
                autocomplete="off" spellcheck="false" />
            </div>
            <div class="cfg-field">
              <label class="cfg-label" for="cfg-password">Password</label>
              <input class="cfg-input" id="cfg-password" type="password"
                placeholder="••••••••"
                autocomplete="new-password" />
            </div>
          </div>

          <div class="cfg-field">
            <label class="cfg-label" for="cfg-plant">Plant ID</label>
            <input class="cfg-input" id="cfg-plant" type="text"
              placeholder="plant-01"
              autocomplete="off" spellcheck="false" />
            <span class="cfg-hint">Topic: wtp/plant/{plantId}/sensors</span>
          </div>

          <div id="cfg-status">
            <span id="cfg-status-dot"></span>
            <span id="cfg-status-text"></span>
          </div>

        </div>

        <div id="cfg-footer">
          <button id="cfg-cancel" class="cfg-btn-ghost">Cancel</button>
          <button id="cfg-connect" class="cfg-btn-primary">Test &amp; Connect →</button>
        </div>

      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    // Cerrar al pulsar fuera del modal
    el.addEventListener('click', (e) => {
      if (e.target === el) this.close();
    });

    // Cerrar con Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('visible')) this.close();
    });

    document.getElementById('cfg-close').addEventListener('click',   () => this.close());
    document.getElementById('cfg-cancel').addEventListener('click',  () => this.close());
    document.getElementById('cfg-connect').addEventListener('click', () => this._onConnect());
  },

  _bindOpenButton() {
    const btn = document.getElementById('btn-settings');
    if (btn) btn.addEventListener('click', () => this.open());
  },

  // ─── Lógica de conexión ─────────────────────────────────────────────────────

  async _onConnect() {
    const brokerUrl = document.getElementById('cfg-broker').value.trim();
    const username  = document.getElementById('cfg-username').value.trim();
    const password  = document.getElementById('cfg-password').value;
    const plantId   = document.getElementById('cfg-plant').value.trim() || 'plant-01';

    if (!brokerUrl) {
      this._setStatus('error', 'Broker URL is required');
      return;
    }

    if (!brokerUrl.startsWith('ws://') && !brokerUrl.startsWith('wss://')) {
      this._setStatus('error', 'URL must start with ws:// or wss://');
      return;
    }

    // Desconectar sesión anterior si la hubiera
    if (MQTTAdapter.isConnected()) {
      await MQTTAdapter.disconnect();
    }

    this._setStatus('connecting', 'Connecting…');
    this._clearTestHandlers();

    // Escuchar el resultado — un único disparo
    const onConnected = () => {
      this._clearTestHandlers();
      // Guardar en localStorage solo si conecta
      saveConfig({ brokerUrl, username, password, plantId });
      // Sincronizar plant ID con el input del topbar
      const plantInput = document.getElementById('plant-id-input');
      if (plantInput) plantInput.value = plantId;
      const mqttPlant = document.getElementById('mqtt-plant-val');
      if (mqttPlant) mqttPlant.textContent = plantId;

      this._setStatus('success', 'Connected — configuration saved');
      setTimeout(() => this.close(), 1200);
    };

    const onError = ({ reason }) => {
      this._clearTestHandlers();
      this._setStatus('error', reason ?? 'Connection failed');
    };

    EventBus.on(EVENTS.MQTT_CONNECTED,    onConnected);
    EventBus.on(EVENTS.MQTT_ERROR,        onError);

    this._testHandlers = [
      [EVENTS.MQTT_CONNECTED, onConnected],
      [EVENTS.MQTT_ERROR,     onError],
    ];

    MQTTAdapter.connect({ brokerUrl, username, password, plantId });
  },

  _clearTestHandlers() {
    this._testHandlers.forEach(([event, fn]) => EventBus.off(event, fn));
    this._testHandlers = [];
  },

  // ─── Estados del status bar ────────────────────────────────────────────────

  _setStatus(state, message = '') {
    const dot  = document.getElementById('cfg-status-dot');
    const text = document.getElementById('cfg-status-text');
    const btn  = document.getElementById('cfg-connect');

    const states = {
      idle:       { dotColor: 'transparent', textColor: 'var(--text2)', btnDisabled: false, btnText: 'Test & Connect →' },
      connecting: { dotColor: 'var(--blue)',  textColor: 'var(--blue)',  btnDisabled: true,  btnText: 'Connecting…'      },
      success:    { dotColor: 'var(--green)', textColor: 'var(--green)', btnDisabled: true,  btnText: 'Connected ✓'      },
      error:      { dotColor: 'var(--red)',   textColor: 'var(--red)',   btnDisabled: false, btnText: 'Retry →'          },
    };

    const cfg = states[state] ?? states.idle;

    if (dot)  { dot.style.background = cfg.dotColor; dot.style.display = state === 'idle' ? 'none' : 'inline-block'; }
    if (text) { text.textContent = message; text.style.color = cfg.textColor; }
    if (btn)  { btn.disabled = cfg.btnDisabled; btn.textContent = cfg.btnText; }

    if (state === 'connecting') {
      dot?.classList.add('pulse');
    } else {
      dot?.classList.remove('pulse');
    }
  },

  destroy() {
    this._clearTestHandlers();
    this._overlay?.remove();
    this._overlay = null;
  },
};

export default ConfigModal;