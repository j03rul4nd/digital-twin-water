/**
 * ConfigModal.js — Modal de configuración y control del broker MQTT.
 *
 * Punto único de control para todo lo relacionado con MQTT.
 * Se abre desde el botón "Configure & Connect →" del panel MQTT
 * y también desde el botón ⚙ del topbar.
 *
 * Estados del modal:
 *   idle        — formulario editable, sin conexión activa
 *   connecting  — intentando conectar, campos bloqueados
 *   connected   — conectado, muestra estado activo con botón Disconnect
 *   error       — falló la conexión, muestra el error, permite corregir
 *
 * El modal detecta automáticamente si ya hay conexión activa al abrirse
 * y muestra el estado correcto — el usuario siempre sabe dónde está.
 *
 * Claves de localStorage:
 *   wtp_broker_url   wtp_username   wtp_password   wtp_plant_id
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import MQTTAdapter from '../sensors/MQTTAdapter.js';

// ─── localStorage helpers ─────────────────────────────────────────────────────

const DEFAULTS = {
  brokerUrl: '',
  username:  '',
  password:  '',
  plantId:   'plant-01',
};

export function loadConfig() {
  return {
    brokerUrl: localStorage.getItem('wtp_broker_url') ?? DEFAULTS.brokerUrl,
    username:  localStorage.getItem('wtp_username')   ?? DEFAULTS.username,
    password:  localStorage.getItem('wtp_password')   ?? DEFAULTS.password,
    plantId:   localStorage.getItem('wtp_plant_id')   ?? DEFAULTS.plantId,
  };
}

export function saveConfig({ brokerUrl, username, password, plantId }) {
  localStorage.setItem('wtp_broker_url', brokerUrl);
  localStorage.setItem('wtp_username',   username);
  localStorage.setItem('wtp_password',   password);
  localStorage.setItem('wtp_plant_id',   plantId);
}

export function clearConfig() {
  ['wtp_broker_url', 'wtp_username', 'wtp_password', 'wtp_plant_id']
    .forEach(k => localStorage.removeItem(k));
}

// ─── ConfigModal ──────────────────────────────────────────────────────────────

const ConfigModal = {
  _overlay:      null,
  _testHandlers: [],

  init() {
    this._build();

    // Botón del topbar (opcional — puede no estar en el DOM)
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => this.open());

    // Escuchar eventos MQTT globales para actualizar el modal si está abierto
    EventBus.on(EVENTS.MQTT_DISCONNECTED, () => {
      if (this._isOpen()) this._renderIdle();
    });
    EventBus.on(EVENTS.MQTT_ERROR, ({ reason }) => {
      if (this._isOpen()) this._setStatus('error', reason ?? 'Connection failed');
    });
  },

  open() {
    const cfg = loadConfig();

    // Pre-rellenar campos
    document.getElementById('cfg-broker').value   = cfg.brokerUrl;
    document.getElementById('cfg-username').value = cfg.username;
    document.getElementById('cfg-password').value = cfg.password;
    document.getElementById('cfg-plant').value    = cfg.plantId;

    // Mostrar estado correcto según si ya hay conexión activa
    if (MQTTAdapter.isConnected()) {
      this._renderConnected(cfg.brokerUrl, cfg.plantId);
    } else {
      this._renderIdle();
    }

    this._overlay.classList.add('visible');

    // Focus en broker si está vacío, si no en el botón de conectar
    const brokerInput = document.getElementById('cfg-broker');
    setTimeout(() => {
      if (!brokerInput.value) brokerInput.focus();
      else document.getElementById('cfg-connect')?.focus();
    }, 50);
  },

  close() {
    this._overlay.classList.remove('visible');
    this._clearTestHandlers();
  },

  _isOpen() {
    return this._overlay?.classList.contains('visible') ?? false;
  },

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'config-overlay';
    el.innerHTML = `
      <div id="config-modal" role="dialog" aria-modal="true" aria-labelledby="cfg-title">

        <div id="cfg-header">
          <div id="cfg-header-left">
            <span id="cfg-source-dot"></span>
            <span id="cfg-title">MQTT Broker</span>
          </div>
          <button id="cfg-close" aria-label="Close">✕</button>
        </div>

        <div id="cfg-body">

          <div class="cfg-field">
            <label class="cfg-label" for="cfg-broker">Broker URL</label>
            <input class="cfg-input" id="cfg-broker" type="text"
              placeholder="wss://your-broker:8884/mqtt"
              autocomplete="off" spellcheck="false" />
            <span class="cfg-hint">Use <code>wss://</code> for cloud brokers (HiveMQ, EMQX). Use <code>ws://</code> for local.</span>
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
            <span class="cfg-hint">Subscribes to <code>wtp/plant/{plantId}/sensors</code></span>
          </div>

          <div id="cfg-status">
            <span id="cfg-status-dot"></span>
            <span id="cfg-status-text"></span>
          </div>

          <!-- Panel visible cuando está conectado -->
          <div id="cfg-connected-info" style="display:none;">
            <div class="cfg-connected-row">
              <span class="cfg-connected-label">Status</span>
              <span class="cfg-connected-value" style="color: var(--green);">● Live</span>
            </div>
            <div class="cfg-connected-row">
              <span class="cfg-connected-label">Broker</span>
              <span class="cfg-connected-value" id="cfg-connected-broker">—</span>
            </div>
            <div class="cfg-connected-row">
              <span class="cfg-connected-label">Plant ID</span>
              <span class="cfg-connected-value" id="cfg-connected-plant">—</span>
            </div>
            <div class="cfg-connected-row">
              <span class="cfg-connected-label">Topic</span>
              <span class="cfg-connected-value" id="cfg-connected-topic">—</span>
            </div>
          </div>

        </div>

        <div id="cfg-footer">
          <button id="cfg-clear" class="cfg-btn-ghost cfg-btn-danger" style="display:none;">
            Clear config
          </button>
          <div style="flex:1"></div>
          <button id="cfg-cancel" class="cfg-btn-ghost">Cancel</button>
          <button id="cfg-connect" class="cfg-btn-primary">Connect →</button>
        </div>

      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    // Cerrar al pulsar fuera
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });

    // Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen()) this.close();
    });

    // Enter en cualquier input dispara connect
    el.querySelectorAll('.cfg-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._onConnect();
      });
    });

    document.getElementById('cfg-close').addEventListener('click',   () => this.close());
    document.getElementById('cfg-cancel').addEventListener('click',  () => this.close());
    document.getElementById('cfg-connect').addEventListener('click', () => this._onConnect());
    document.getElementById('cfg-clear').addEventListener('click',   () => this._onClear());
  },

  // ─── Estados del modal ──────────────────────────────────────────────────────

  _renderIdle() {
    this._setInputsDisabled(false);
    this._setStatus('idle');
    this._showConnectedInfo(false);

    const connectBtn = document.getElementById('cfg-connect');
    const clearBtn   = document.getElementById('cfg-clear');
    if (connectBtn) { connectBtn.textContent = 'Connect →'; connectBtn.disabled = false; connectBtn.className = 'cfg-btn-primary'; }
    if (clearBtn)   { clearBtn.style.display = loadConfig().brokerUrl ? 'block' : 'none'; }

    // Dot del header — gris (sin conexión)
    const dot = document.getElementById('cfg-source-dot');
    if (dot) { dot.style.background = 'var(--text2)'; dot.classList.remove('pulse'); }
  },

  _renderConnecting() {
    this._setInputsDisabled(true);
    this._setStatus('connecting', 'Connecting…');
    this._showConnectedInfo(false);

    const connectBtn = document.getElementById('cfg-connect');
    if (connectBtn) { connectBtn.textContent = 'Connecting…'; connectBtn.disabled = true; }

    const dot = document.getElementById('cfg-source-dot');
    if (dot) { dot.style.background = 'var(--blue)'; dot.classList.add('pulse'); }
  },

  _renderConnected(brokerUrl, plantId) {
    this._setInputsDisabled(true);
    this._setStatus('idle');
    this._showConnectedInfo(true, brokerUrl, plantId);

    const connectBtn = document.getElementById('cfg-connect');
    if (connectBtn) {
      connectBtn.textContent  = 'Disconnect';
      connectBtn.disabled     = false;
      connectBtn.className    = 'cfg-btn-disconnect';
    }

    const clearBtn = document.getElementById('cfg-clear');
    if (clearBtn) clearBtn.style.display = 'none';

    const dot = document.getElementById('cfg-source-dot');
    if (dot) { dot.style.background = 'var(--green)'; dot.classList.remove('pulse'); }
  },

  _showConnectedInfo(show, brokerUrl = '', plantId = '') {
    const info = document.getElementById('cfg-connected-info');
    const form = document.querySelector('#cfg-body .cfg-field');
    if (!info) return;

    info.style.display = show ? 'block' : 'none';

    if (show) {
      const host = this._brokerHost(brokerUrl);
      document.getElementById('cfg-connected-broker').textContent = host;
      document.getElementById('cfg-connected-plant').textContent  = plantId;
      document.getElementById('cfg-connected-topic').textContent  = `wtp/plant/${plantId}/sensors`;
    }

    // Ocultar/mostrar los campos del formulario cuando está conectado
    const fields = document.querySelectorAll('#cfg-body > .cfg-field, #cfg-body > .cfg-row');
    fields.forEach(f => { f.style.display = show ? 'none' : ''; });
  },

  _setInputsDisabled(disabled) {
    ['cfg-broker', 'cfg-username', 'cfg-password', 'cfg-plant'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  },

  // ─── Acciones ───────────────────────────────────────────────────────────────

  async _onConnect() {
    // Si ya está conectado, desconectar
    if (MQTTAdapter.isConnected()) {
      await MQTTAdapter.disconnect();
      return;
    }

    const brokerUrl = document.getElementById('cfg-broker').value.trim();
    const username  = document.getElementById('cfg-username').value.trim();
    const password  = document.getElementById('cfg-password').value;
    const plantId   = document.getElementById('cfg-plant').value.trim() || 'plant-01';

    // Validación
    if (!brokerUrl) {
      this._setStatus('error', 'Broker URL is required');
      document.getElementById('cfg-broker').focus();
      return;
    }
    if (!brokerUrl.startsWith('ws://') && !brokerUrl.startsWith('wss://')) {
      this._setStatus('error', 'URL must start with ws:// or wss://');
      document.getElementById('cfg-broker').focus();
      return;
    }

    this._renderConnecting();
    this._clearTestHandlers();

    const onConnected = () => {
      this._clearTestHandlers();
      saveConfig({ brokerUrl, username, password, plantId });
      this._syncPlantId(plantId);
      this._renderConnected(brokerUrl, plantId);
    };

    const onError = ({ reason }) => {
      this._clearTestHandlers();
      this._renderIdle();
      this._setStatus('error', reason ?? 'Connection failed — check URL and credentials');
    };

    EventBus.on(EVENTS.MQTT_CONNECTED, onConnected);
    EventBus.on(EVENTS.MQTT_ERROR,     onError);

    this._testHandlers = [
      [EVENTS.MQTT_CONNECTED, onConnected],
      [EVENTS.MQTT_ERROR,     onError],
    ];

    MQTTAdapter.connect({ brokerUrl, username, password, plantId });
  },

  _onClear() {
    clearConfig();
    document.getElementById('cfg-broker').value   = '';
    document.getElementById('cfg-username').value = '';
    document.getElementById('cfg-password').value = '';
    document.getElementById('cfg-plant').value    = 'plant-01';
    this._renderIdle();
    document.getElementById('cfg-clear').style.display = 'none';
  },

  _syncPlantId(plantId) {
    const plantInput = document.getElementById('plant-id-input');
    if (plantInput) plantInput.value = plantId;
    const mqttPlant = document.getElementById('mqtt-plant-val');
    if (mqttPlant) mqttPlant.textContent = plantId;
  },

  _setStatus(state, message = '') {
    const dot  = document.getElementById('cfg-status-dot');
    const text = document.getElementById('cfg-status-text');

    const MAP = {
      idle:       { color: 'transparent', show: false },
      connecting: { color: 'var(--blue)',  show: true  },
      error:      { color: 'var(--red)',   show: true  },
      success:    { color: 'var(--green)', show: true  },
    };

    const s = MAP[state] ?? MAP.idle;
    if (dot)  { dot.style.background = s.color; dot.style.display = s.show ? 'inline-block' : 'none'; }
    if (text) { text.textContent = message; text.style.color = s.color; }

    if (state === 'connecting') dot?.classList.add('pulse');
    else dot?.classList.remove('pulse');
  },

  _brokerHost(url) {
    try { return new URL(url).hostname; } catch { return url; }
  },

  _clearTestHandlers() {
    this._testHandlers.forEach(([e, fn]) => EventBus.off(e, fn));
    this._testHandlers = [];
  },

  destroy() {
    this._clearTestHandlers();
    this._overlay?.remove();
    this._overlay = null;
  },
};

export default ConfigModal;