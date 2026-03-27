/**
 * AlertPanel.js — Panel de alertas activas (panel derecho, sub-panel superior).
 *
 * Escucha EVENTS.RULE_TRIGGERED.
 * En init() llama a RuleEngine.getActiveAlerts() para recuperar alertas
 * existentes antes del primer evento — necesario si el panel se reinicia.
 *
 * Orden: danger primero, warning después.
 * Dentro de cada severidad, por timestamp descendente (más reciente arriba).
 *
 * Timestamps relativos actualizados cada 30s via setInterval.
 *
 * Resolución de alertas: opacity: 0 → remove() a 200ms.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';

const AlertPanel = {
  /** @type {Function} */
  _handler: null,

  /** @type {number | null} — ID del setInterval de timestamps */
  _timestampTimer: null,

  /**
   * Inicializa el panel.
   * RuleEngine se importa dinámicamente para evitar dependencia circular
   * entre fases — en Fase 3 el RuleEngine aún no existe, se añade en Fase 4.
   * Cuando RuleEngine exista, descomentar el bloque de recuperación.
   *
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    // ── Recuperar alertas activas existentes (cuando RuleEngine exista en Fase 4) ──
    // import('../sensors/RuleEngine.js').then(({ default: RuleEngine }) => {
    //   RuleEngine.getActiveAlerts()
    //     .sort(this._sortAlerts)
    //     .forEach(alert => this._renderAlert(alert));
    //   this._updateEmptyState();
    //   this._updateCounter();
    // });

    // Suscribir al EventBus
    this._handler = (alert) => this._handleAlert(alert);
    EventBus.on(EVENTS.RULE_TRIGGERED, this._handler);

    // Timer de timestamps relativos — actualiza cada 30s
    this._timestampTimer = setInterval(() => {
      this._refreshTimestamps();
    }, 30_000);
  },

  /**
   * Gestiona una alerta entrante.
   * active: true  → renderizar (si no existe ya)
   * active: false → resolver con fade out
   * @param {{ id, severity, sensorIds, message, timestamp, active }} alert
   */
  _handleAlert(alert) {
    if (alert.active) {
      // Deduplicar — no renderizar si ya existe
      if (!this._getAlertEl(alert.id)) {
        this._renderAlert(alert);
        this._updateEmptyState();
        this._updateCounter();
      }
    } else {
      this._resolveAlert(alert.id);
    }
  },

  /**
   * Crea y añade el elemento DOM de una alerta.
   * Danger siempre antes que el primer warning existente.
   * @param {{ id, severity, sensorIds, message, timestamp }} alert
   */
  _renderAlert(alert) {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    const item = document.createElement('div');
    item.className = 'alert-item';
    item.dataset.alertId = alert.id;
    item.dataset.severity = alert.severity;
    item.dataset.timestamp = alert.timestamp;

    const accentColor = alert.severity === 'danger' ? 'var(--red)' : 'var(--amber)';

    item.innerHTML = `
      <div class="alert-accent" style="background: ${accentColor};"></div>
      <div class="alert-sensors">${alert.sensorIds.join(' · ')}</div>
      <div class="alert-message">${alert.message}</div>
      <div class="alert-time" data-timestamp="${alert.timestamp}">${this._relativeTime(alert.timestamp)}</div>
    `;

    // Insertar: danger antes del primer warning
    if (alert.severity === 'danger') {
      const firstWarning = body.querySelector('[data-severity="warning"]');
      if (firstWarning) {
        body.insertBefore(item, firstWarning);
      } else {
        body.appendChild(item);
      }
    } else {
      body.appendChild(item);
    }

    // Quitar el estado vacío si existía
    const empty = body.querySelector('.alert-empty');
    if (empty) empty.remove();
  },

  /**
   * Resuelve una alerta con fade out y posterior eliminación del DOM.
   * @param {string} alertId
   */
  _resolveAlert(alertId) {
    const el = this._getAlertEl(alertId);
    if (!el) return;

    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      this._updateEmptyState();
      this._updateCounter();
    }, 200);
  },

  /**
   * Muestra el estado vacío si no hay alertas activas.
   */
  _updateEmptyState() {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    const hasAlerts = body.querySelector('.alert-item');
    const hasEmpty  = body.querySelector('.alert-empty');

    if (!hasAlerts && !hasEmpty) {
      const empty = document.createElement('div');
      empty.className = 'alert-empty';
      empty.textContent = 'No active alerts';
      body.appendChild(empty);
    }
  },

  /**
   * Actualiza el contador de alertas en el panel header.
   */
  _updateCounter() {
    const body = document.getElementById('alerts-body');
    const counter = document.getElementById('alert-count');
    if (!body || !counter) return;

    const count = body.querySelectorAll('.alert-item').length;
    counter.textContent = count > 0 ? `${count} active` : '—';
  },

  /**
   * Actualiza todos los timestamps relativos visibles.
   * Llamado por el setInterval cada 30s.
   */
  _refreshTimestamps() {
    const body = document.getElementById('alerts-body');
    if (!body) return;

    body.querySelectorAll('[data-timestamp]').forEach(el => {
      const ts = parseInt(el.dataset.timestamp, 10);
      el.textContent = this._relativeTime(ts);
    });
  },

  /**
   * Calcula el tiempo relativo desde un timestamp.
   * @param {number} timestamp — ms desde epoch
   * @returns {string} e.g. '14s ago', '2m ago', '1h ago'
   */
  _relativeTime(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  },

  /**
   * Devuelve el elemento DOM de una alerta por ID.
   * @param {string} alertId
   * @returns {HTMLElement | null}
   */
  _getAlertEl(alertId) {
    return document.querySelector(`[data-alert-id="${alertId}"]`);
  },

  /**
   * Helper de ordenación: danger primero, luego por timestamp descendente.
   */
  _sortAlerts(a, b) {
    if (a.severity !== b.severity) return a.severity === 'danger' ? -1 : 1;
    return b.timestamp - a.timestamp;
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.RULE_TRIGGERED, this._handler);
      this._handler = null;
    }
    if (this._timestampTimer !== null) {
      clearInterval(this._timestampTimer);
      this._timestampTimer = null;
    }
  },
};

export default AlertPanel;