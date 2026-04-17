/**
 * AlertPanel.js — Panel de alertas con historial.
 *
 * Dos secciones:
 *   Active  — alertas que siguen activas ahora mismo
 *   History — alertas que se resolvieron (últimas MAX_HISTORY)
 *
 * Las alertas resueltas NO desaparecen — pasan a History con:
 *   - timestamp de cuándo se activaron
 *   - cuánto tiempo estuvieron activas ("was active for 45s")
 *   - acento gris para distinguirlas visualmente de las activas
 *
 * El usuario siempre puede ver qué pasó, cuándo y cuánto duró.
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import RuleEngine  from '../sensors/RuleEngine.js';
import ReplayController from '../core/ReplayController.js';
import EventMarkers from '../charts/EventMarkers.js';

// Bandera para ignorar eventos durante una limpieza activa.
// Evita que RuleEngine.clearAlerts() añada items al historial
// cuando el panel ya ha sido vaciado por DATA_SOURCE_CLEARING.
let _clearing = false;

const MAX_HISTORY = 20;

const AlertPanel = {
  _handler:        null,
  _timestampTimer: null,

  /** @type {Map<string, number>} alertId → timestamp de activación */
  _activeSince: new Map(),

  /** @type {Array} historial en memoria (para reconstruir si hace falta) */
  _history: [],

  init() {
    this._buildDOM();

    // Recuperar alertas activas existentes al arrancar
    RuleEngine.getActiveAlerts()
      .sort(this._sortAlerts)
      .forEach(alert => {
        this._activeSince.set(alert.id, alert.timestamp);
        this._renderActive(alert);
      });

    this._updateActiveEmpty();
    this._updateCounters();

    // Suscribir a alertas
    this._handler = (alert) => this._handleAlert(alert);
    EventBus.on(EVENTS.RULE_TRIGGERED, this._handler);

    // Limpiar todo el estado cuando cambia la fuente de datos.
    // Debe ejecutarse ANTES de que RuleEngine.clearAlerts() emita sus eventos.
    EventBus.on(EVENTS.DATA_SOURCE_CLEARING, () => this.clearAll());

    // ── Replay mode ────────────────────────────────────────────────────────
    // Al entrar o scrubbear, repintamos la sección Active con el set
    // snapshot.activeAlertIds. Al salir, restauramos la vista live.
    this._replayHandler = ({ snapshot }) => {
      if (!snapshot) return;
      this._renderReplayActive(snapshot.activeAlertIds || []);
    };
    EventBus.on(EVENTS.REPLAY_ENTERED,  this._replayHandler);
    EventBus.on(EVENTS.REPLAY_SCRUBBED, this._replayHandler);

    this._replayExitHandler = () => this._restoreLiveActive();
    EventBus.on(EVENTS.REPLAY_EXITED, this._replayExitHandler);

    // Actualizar timestamps cada 10s (más frecuente que antes para alertas cortas)
    this._timestampTimer = setInterval(() => this._refreshTimestamps(), 10_000);
  },

  // ─── DOM inicial ─────────────────────────────────────────────────────────────

  _buildDOM() {
    const panel = document.getElementById('panel-alerts');
    if (!panel) return;

    // Reemplazar el body estático por la estructura de dos secciones
    const existingBody = document.getElementById('alerts-body');
    if (existingBody) existingBody.remove();

    panel.insertAdjacentHTML('beforeend', `
      <div id="alerts-active-section">
        <div id="alerts-body"></div>
      </div>

      <div id="alerts-history-section" style="display:none;">
        <div class="alerts-section-header">
          <span class="alerts-section-title">History</span>
          <button class="alerts-clear-btn" id="alerts-clear-btn">Clear</button>
        </div>
        <div id="alerts-history-body"></div>
      </div>
    `);

    document.getElementById('alerts-clear-btn')?.addEventListener('click', () => {
      this._clearHistory();
    });
  },

  // ─── Gestión de alertas entrantes ────────────────────────────────────────────

  _handleAlert(alert) {
    // Ignorar eventos durante limpieza activa (cambio de fuente de datos)
    if (_clearing) return;

    // Durante replay no mutamos el panel desde RULE_TRIGGERED: la vista
    // refleja el snapshot histórico y se repinta al hacer scrub.
    if (ReplayController.isActive()) return;

    if (alert.active) {
      if (!this._getActiveEl(alert.id)) {
        this._activeSince.set(alert.id, alert.timestamp);
        this._renderActive(alert);
        this._updateActiveEmpty();
        this._updateCounters();
      }
    } else {
      this._resolveAlert(alert);
    }
  },

  // ─── Replay mode helpers ─────────────────────────────────────────────────────

  /**
   * Repaints the Active section with the set of alerts active at a given
   * historical snapshot. Alert metadata (severity, message, sensorIds) is
   * pulled from EventMarkers which captured them at the time they fired.
   *
   * @param {string[]} alertIds
   */
  _renderReplayActive(alertIds) {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    // Indexar marcadores de alerta por id para hidratar los items
    // con la metadata original (severity, message, sensorIds, timestamp).
    const byId = new Map();
    for (const ev of (EventMarkers._events || [])) {
      if (ev.type === 'alert' && ev.id) byId.set(ev.id, ev);
    }

    body.innerHTML = '';

    if (!alertIds.length) {
      this._updateActiveEmpty();
      // Contador refleja los ids del snapshot
      const counter = document.getElementById('alert-count');
      if (counter) {
        counter.textContent = '0 in replay';
        counter.style.color = 'var(--text2)';
      }
      return;
    }

    alertIds.forEach(id => {
      const ev = byId.get(id);
      if (!ev) return;
      const pseudoAlert = {
        id,
        severity:  ev.severity ?? 'warning',
        sensorIds: ev.sensorIds ?? [],
        message:   ev.label ?? id,
        timestamp: ev.timestamp,
      };
      this._renderActive(pseudoAlert);
    });

    // Contador custom durante replay
    const counter = document.getElementById('alert-count');
    if (counter) {
      counter.textContent = `${alertIds.length} in replay`;
      counter.style.color = 'var(--red)';
    }
  },

  /**
   * Called when replay exits: rebuild Active section from RuleEngine's
   * current live state.
   */
  _restoreLiveActive() {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    body.innerHTML = '';
    this._activeSince.clear();

    RuleEngine.getActiveAlerts()
      .sort(this._sortAlerts)
      .forEach(alert => {
        this._activeSince.set(alert.id, alert.timestamp);
        this._renderActive(alert);
      });

    this._updateActiveEmpty();
    this._updateCounters();
  },

  // ─── Render alerta activa ────────────────────────────────────────────────────

  _renderActive(alert) {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    const item = document.createElement('div');
    item.className       = 'alert-item';
    item.dataset.alertId = alert.id;
    item.dataset.severity  = alert.severity;
    item.dataset.timestamp = alert.timestamp;

    const accentColor = alert.severity === 'danger' ? 'var(--red)' : 'var(--amber)';

    item.innerHTML = `
      <div class="alert-accent" style="background: ${accentColor};"></div>
      <div class="alert-badge alert-badge--${alert.severity}">${alert.severity.toUpperCase()}</div>
      <div class="alert-sensors">${alert.sensorIds.join(' · ')}</div>
      <div class="alert-message">${alert.message}</div>
      <div class="alert-time" data-timestamp="${alert.timestamp}">
        ${this._relativeTime(alert.timestamp)}
      </div>
    `;

    // Danger antes del primer warning
    if (alert.severity === 'danger') {
      const firstWarning = body.querySelector('[data-severity="warning"]');
      if (firstWarning) { body.insertBefore(item, firstWarning); return; }
    }
    body.appendChild(item);

    const empty = body.querySelector('.alert-empty');
    if (empty) empty.remove();
  },

  // ─── Resolver alerta → mover a History ──────────────────────────────────────

  _resolveAlert(alert) {
    const el = this._getActiveEl(alert.id);
    const activatedAt = this._activeSince.get(alert.id) ?? alert.timestamp;
    const duration    = Math.floor((alert.timestamp - activatedAt) / 1000);

    this._activeSince.delete(alert.id);

    // Fade out del elemento activo
    if (el) {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity    = '0';
      setTimeout(() => {
        el.remove();
        this._updateActiveEmpty();
        this._updateCounters();
      }, 300);
    }

    // Añadir al historial
    this._addToHistory({ ...alert, activatedAt, duration });
  },

  // ─── Historial ───────────────────────────────────────────────────────────────

  _addToHistory(resolvedAlert) {
    this._history.unshift(resolvedAlert);
    if (this._history.length > MAX_HISTORY) this._history.pop();

    this._renderHistoryItem(resolvedAlert, true); // true = prepend
    this._trimHistoryDOM();
    this._showHistorySection(true);
    this._updateCounters();
  },

  _renderHistoryItem(alert, prepend = false) {
    const body = document.getElementById('alerts-history-body');
    if (!body) return;

    const item = document.createElement('div');
    item.className = 'alert-item alert-item--resolved';
    item.dataset.historyId = alert.id;

    const durationText = this._formatDuration(alert.duration);
    const accentColor  = alert.severity === 'danger' ? 'var(--red)' : 'var(--amber)';

    item.innerHTML = `
      <div class="alert-accent alert-accent--resolved" style="background: ${accentColor};"></div>
      <div class="alert-resolved-row">
        <span class="alert-badge alert-badge--resolved">${alert.severity.toUpperCase()}</span>
        <span class="alert-resolved-duration">active ${durationText}</span>
      </div>
      <div class="alert-sensors">${alert.sensorIds.join(' · ')}</div>
      <div class="alert-message alert-message--resolved">${alert.message}</div>
      <div class="alert-time" data-timestamp="${alert.timestamp}">
        resolved ${this._relativeTime(alert.timestamp)}
      </div>
    `;

    if (prepend && body.firstChild) {
      body.insertBefore(item, body.firstChild);
    } else {
      body.appendChild(item);
    }
  },

  _trimHistoryDOM() {
    const body = document.getElementById('alerts-history-body');
    if (!body) return;
    const items = body.querySelectorAll('.alert-item--resolved');
    if (items.length > MAX_HISTORY) {
      for (let i = MAX_HISTORY; i < items.length; i++) items[i].remove();
    }
  },

  _clearHistory() {
    this._history = [];
    const body = document.getElementById('alerts-history-body');
    if (body) body.innerHTML = '';
    this._showHistorySection(false);
    this._updateCounters();
  },

  /**
   * Limpieza completa: borra activas, historial, mapas internos y DOM.
   * Llamado automáticamente al recibir DATA_SOURCE_CLEARING.
   * También exportado para uso directo si es necesario.
   */
  clearAll() {
    _clearing = true;

    // Limpiar mapa de tiempos de activación
    this._activeSince.clear();

    // Limpiar sección de alertas activas
    const activeBody = document.getElementById('alerts-body');
    if (activeBody) activeBody.innerHTML = '';

    // Limpiar historial en memoria y DOM
    this._history = [];
    const historyBody = document.getElementById('alerts-history-body');
    if (historyBody) historyBody.innerHTML = '';
    this._showHistorySection(false);

    // Restaurar estado visual
    this._updateActiveEmpty();
    this._updateCounters();

    _clearing = false;
  },

  _showHistorySection(show) {
    const section = document.getElementById('alerts-history-section');
    if (section) section.style.display = show && this._history.length > 0 ? 'block' : 'none';
  },

  // ─── Helpers de UI ───────────────────────────────────────────────────────────

  _updateActiveEmpty() {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    const hasAlerts = body.querySelector('.alert-item');
    const hasEmpty  = body.querySelector('.alert-empty');

    if (!hasAlerts && !hasEmpty) {
      const empty = document.createElement('div');
      empty.className   = 'alert-empty';
      empty.textContent = 'No active alerts';
      body.appendChild(empty);
    } else if (hasAlerts && hasEmpty) {
      hasEmpty.remove();
    }
  },

  _updateCounters() {
    const body    = document.getElementById('alerts-body');
    const counter = document.getElementById('alert-count');
    if (!body || !counter) return;

    const activeCount  = body.querySelectorAll('.alert-item:not(.alert-item--resolved)').length;
    const historyCount = this._history.length;

    if (activeCount > 0) {
      counter.textContent = `${activeCount} active`;
      counter.style.color = 'var(--red)';
    } else if (historyCount > 0) {
      counter.textContent = `${historyCount} in history`;
      counter.style.color = 'var(--text2)';
    } else {
      counter.textContent = '—';
      counter.style.color = 'var(--text2)';
    }
  },

  _refreshTimestamps() {
    document.querySelectorAll('.alert-time[data-timestamp]').forEach(el => {
      const ts       = parseInt(el.dataset.timestamp, 10);
      const prefix   = el.closest('.alert-item--resolved') ? 'resolved ' : '';
      el.textContent = prefix + this._relativeTime(ts);
    });
  },

  // ─── Utilidades ──────────────────────────────────────────────────────────────

  _relativeTime(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5)    return 'just now';
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  },

  _formatDuration(seconds) {
    if (seconds < 5)    return 'a moment';
    if (seconds < 60)   return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h`;
  },

  _getActiveEl(alertId) {
    return document.querySelector(`#alerts-body [data-alert-id="${alertId}"]`);
  },

  _sortAlerts(a, b) {
    if (a.severity !== b.severity) return a.severity === 'danger' ? -1 : 1;
    return b.timestamp - a.timestamp;
  },

  /**
   * Returns a copy of the resolved alerts history.
   * Used by ReportEngine to include resolved alerts in generated reports.
   * Each item has: id, severity, sensorIds, message, timestamp, activatedAt, duration.
   */
  getResolvedAlerts() {
    return this._history.map(a => ({
      ...a,
      resolvedAt: a.activatedAt != null ? a.activatedAt + a.duration * 1000 : a.timestamp,
    }));
  },

  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.RULE_TRIGGERED, this._handler);
      this._handler = null;
    }
    if (this._replayHandler) {
      EventBus.off(EVENTS.REPLAY_ENTERED,  this._replayHandler);
      EventBus.off(EVENTS.REPLAY_SCRUBBED, this._replayHandler);
      this._replayHandler = null;
    }
    if (this._replayExitHandler) {
      EventBus.off(EVENTS.REPLAY_EXITED, this._replayExitHandler);
      this._replayExitHandler = null;
    }
    if (this._timestampTimer !== null) {
      clearInterval(this._timestampTimer);
      this._timestampTimer = null;
    }
    this._activeSince.clear();
    this._history = [];
  },
};

export default AlertPanel;