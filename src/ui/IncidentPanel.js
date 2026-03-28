/**
 * IncidentPanel.js — Panel de simulación de incidentes.
 *
 * Panel flotante sobre la escena 3D (centrado abajo).
 * Solo visible en modo simulador — se oculta cuando MQTT está conectado.
 *
 * Permite activar escenarios de fallo con un click:
 *   Filter #1 Clog     → DP sube a 185 mbar (warning)
 *   Filter #1 Critical → DP sube a 215 mbar (danger)
 *   Chlorine Deficit   → dosis no escala con caudal (danger)
 *   Low Tank Level     → nivel cae a ~18% (warning)
 *   pH Anomaly         → pH fuera de rango (warning)
 *
 * Cuando un escenario está activo:
 *   - El botón activo se ilumina
 *   - Un countdown muestra el tiempo restante
 *   - Botón "Reset" cancela el escenario inmediatamente
 *
 * Se minimiza a una pill cuando no hay escenario activo.
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import SensorWorker from '../sensors/SensorWorker.js';

const SCENARIOS = [
  {
    name:     'filter_1_clog',
    label:    'Filter #1 Clog',
    icon:     '⚠',
    severity: 'warning',
    desc:     'DP rises to warning threshold',
  },
  {
    name:     'filter_1_critical',
    label:    'Filter #1 Critical',
    icon:     '🔴',
    severity: 'danger',
    desc:     'DP exceeds safe limit',
  },
  {
    name:     'chlorine_deficit',
    label:    'Chlorine Deficit',
    icon:     '⚠',
    severity: 'danger',
    desc:     'Dose not scaling with flow',
  },
  {
    name:     'low_tank',
    label:    'Low Tank Level',
    icon:     '⚠',
    severity: 'warning',
    desc:     'Clearwell draining',
  },
  {
    name:     'ph_anomaly',
    label:    'pH Anomaly',
    icon:     '⚠',
    severity: 'warning',
    desc:     'Coagulation pH out of range',
  },
];

const DURATION_MS = 30_000; // 30 segundos por escenario

const IncidentPanel = {
  _el:             null,
  _handlers:       [],
  _countdownTimer: null,
  _activeScenario: null,  // { name, expiresAt }
  _expanded:       false,

  init() {
    this._build();

    // Escuchar cambios de escenario desde el Worker
    const onScenario = (scenario) => {
      this._activeScenario = scenario;
      this._render();
    };

    // Ocultar cuando MQTT conecta, mostrar cuando desconecta
    const onMqttConnected    = () => this._setVisible(false);
    const onMqttDisconnected = () => this._setVisible(true);
    const onMqttError        = () => this._setVisible(true);

    EventBus.on(EVENTS.SCENARIO_CHANGED,   onScenario);
    EventBus.on(EVENTS.MQTT_CONNECTED,     onMqttConnected);
    EventBus.on(EVENTS.MQTT_DISCONNECTED,  onMqttDisconnected);
    EventBus.on(EVENTS.MQTT_ERROR,         onMqttError);

    this._handlers = [
      [EVENTS.SCENARIO_CHANGED,   onScenario],
      [EVENTS.MQTT_CONNECTED,     onMqttConnected],
      [EVENTS.MQTT_DISCONNECTED,  onMqttDisconnected],
      [EVENTS.MQTT_ERROR,         onMqttError],
    ];

    this._render();
  },

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'incident-panel';
    el.innerHTML = `
      <div id="incident-pill" title="Incident Simulator">
        <span id="incident-pill-icon">⚡</span>
        <span id="incident-pill-label">Incident Simulator</span>
        <span id="incident-pill-status"></span>
        <button id="incident-toggle" aria-label="Toggle incident panel">▲</button>
      </div>
      <div id="incident-body">
        <div id="incident-active-info" style="display:none;">
          <div id="incident-active-name"></div>
          <div id="incident-countdown"></div>
          <button id="incident-reset-btn" class="incident-reset">Reset to normal</button>
        </div>
        <div id="incident-scenarios"></div>
      </div>
    `;

    document.body.appendChild(el);
    this._el = el;

    // Toggle expand/collapse
    document.getElementById('incident-toggle').addEventListener('click', () => {
      this._expanded = !this._expanded;
      this._render();
    });

    document.getElementById('incident-pill').addEventListener('click', (e) => {
      if (e.target.id === 'incident-toggle') return;
      this._expanded = !this._expanded;
      this._render();
    });

    // Reset
    document.getElementById('incident-reset-btn').addEventListener('click', () => {
      SensorWorker.scenario('reset');
    });

    // Generar botones de escenario
    const container = document.getElementById('incident-scenarios');
    SCENARIOS.forEach(sc => {
      const btn = document.createElement('button');
      btn.className         = `incident-btn incident-btn--${sc.severity}`;
      btn.dataset.scenario  = sc.name;
      btn.innerHTML = `
        <span class="incident-btn-label">${sc.label}</span>
        <span class="incident-btn-desc">${sc.desc}</span>
      `;
      btn.addEventListener('click', () => {
        SensorWorker.scenario(sc.name, DURATION_MS);
        this._expanded = true;
      });
      container.appendChild(btn);
    });
  },

  // ─── Render ─────────────────────────────────────────────────────────────────

  _render() {
    const body   = document.getElementById('incident-body');
    const toggle = document.getElementById('incident-toggle');
    const pill   = document.getElementById('incident-pill');

    if (!body) return;

    // Expandir/colapsar
    body.style.display = this._expanded ? 'block' : 'none';
    if (toggle) toggle.textContent = this._expanded ? '▼' : '▲';

    // Estado activo
    const activeInfo  = document.getElementById('incident-active-info');
    const scenarios   = document.getElementById('incident-scenarios');
    const pillStatus  = document.getElementById('incident-pill-status');
    const pillIcon    = document.getElementById('incident-pill-icon');

    if (this._activeScenario) {
      const sc = SCENARIOS.find(s => s.name === this._activeScenario.name);

      if (activeInfo) activeInfo.style.display = 'block';
      if (scenarios)  scenarios.style.display  = 'none';

      const nameEl = document.getElementById('incident-active-name');
      if (nameEl && sc) {
        nameEl.textContent = `Active: ${sc.label}`;
        nameEl.className   = `incident-active-name incident-active-name--${sc.severity}`;
      }

      // Pill
      if (pillStatus && sc) {
        pillStatus.textContent  = sc.label;
        pillStatus.style.color  = sc.severity === 'danger' ? 'var(--red)' : 'var(--amber)';
      }
      if (pillIcon) pillIcon.textContent = '🔴';
      if (pill) pill.classList.add('has-active');

      // Countdown
      this._startCountdown();

      // Highlight botón activo
      document.querySelectorAll('.incident-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.scenario === this._activeScenario?.name);
      });

    } else {
      if (activeInfo) activeInfo.style.display = 'none';
      if (scenarios)  scenarios.style.display  = 'grid';
      if (pillStatus) pillStatus.textContent = '';
      if (pillIcon)   pillIcon.textContent   = '⚡';
      if (pill)       pill.classList.remove('has-active');

      document.querySelectorAll('.incident-btn').forEach(btn => {
        btn.classList.remove('is-active');
      });

      this._stopCountdown();
    }
  },

  _startCountdown() {
    this._stopCountdown();
    this._updateCountdown();
    this._countdownTimer = setInterval(() => this._updateCountdown(), 500);
  },

  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  _updateCountdown() {
    if (!this._activeScenario) return;
    const remaining = Math.max(0, Math.ceil((this._activeScenario.expiresAt - Date.now()) / 1000));
    const el = document.getElementById('incident-countdown');
    if (el) {
      el.textContent = remaining > 0
        ? `Resets in ${remaining}s`
        : 'Resetting…';
    }
  },

  _setVisible(visible) {
    if (this._el) {
      this._el.style.display = visible ? 'block' : 'none';
    }
    // Si se oculta, cancelar escenario activo
    if (!visible && this._activeScenario) {
      SensorWorker.scenario('reset');
    }
  },

  destroy() {
    this._stopCountdown();
    this._handlers.forEach(([e, fn]) => EventBus.off(e, fn));
    this._handlers = [];
    this._el?.remove();
    this._el = null;
  },
};

export default IncidentPanel;