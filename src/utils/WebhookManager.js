/**
 * WebhookManager.js — Envío de webhooks en eventos de alerta.
 *
 * Cuando el RuleEngine activa una alerta, WebhookManager hace un POST
 * a las URLs configuradas por el usuario con el payload del evento.
 *
 * Sin backend — las peticiones salen directamente desde el browser.
 * Esto funciona si el servidor destino tiene CORS abierto (Zapier, n8n,
 * Make, Slack incoming webhooks, Discord, etc.) Si el destino no tiene
 * CORS, el usuario necesita un proxy — documentado en el README.
 *
 * Config guardada en localStorage. Editable desde WebhookPanel en la UI.
 *
 * Claves de localStorage:
 *   wtp_webhooks   — JSON array de { id, url, name, events, enabled }
 *
 * Eventos soportados:
 *   alert.danger   — se activa cuando severity === 'danger' && active === true
 *   alert.warning  — se activa cuando severity === 'warning' && active === true
 *   alert.resolved — se activa cuando active === false (cualquier severidad)
 *
 * Payload enviado (POST, Content-Type: application/json):
 * {
 *   event:     'alert.danger' | 'alert.warning' | 'alert.resolved',
 *   timestamp: number,
 *   plant:     string,        — plantId del localStorage
 *   alert: {
 *     id:        string,
 *     severity:  'warning' | 'danger',
 *     sensorIds: string[],
 *     message:   string,
 *     active:    boolean,
 *   }
 * }
 */

import EventBus   from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';

const STORAGE_KEY = 'wtp_webhooks';

// ─── Config helpers ───────────────────────────────────────────────────────────

export function loadWebhooks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveWebhooks(webhooks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(webhooks));
}

function getPlantId() {
  return localStorage.getItem('wtp_plant_id') ?? 'plant-01';
}

// ─── WebhookManager ───────────────────────────────────────────────────────────

const WebhookManager = {
  _handler: null,

  /** Registro de resultados de los últimos envíos — para mostrar en la UI */
  _lastResults: new Map(), // webhookId → { ok, status, ts }

  init() {
    this._handler = (alert) => this._handleAlert(alert);
    EventBus.on(EVENTS.RULE_TRIGGERED, this._handler);
  },

  _handleAlert(alert) {
    const webhooks = loadWebhooks().filter(w => w.enabled);
    if (webhooks.length === 0) return;

    const eventType = alert.active
      ? `alert.${alert.severity}`   // 'alert.danger' | 'alert.warning'
      : 'alert.resolved';

    const payload = {
      event:     eventType,
      timestamp: alert.timestamp,
      plant:     getPlantId(),
      alert: {
        id:        alert.id,
        severity:  alert.severity,
        sensorIds: alert.sensorIds,
        message:   alert.message,
        active:    alert.active,
      },
    };

    webhooks.forEach(webhook => {
      // Filtrar por tipo de evento configurado
      if (!webhook.events.includes(eventType)) return;
      this._send(webhook, payload);
    });
  },

  async _send(webhook, payload) {
    try {
      // Usar text/plain evita el preflight CORS (OPTIONS request)
      // que bloquea el body en servicios como webhook.site, Slack, n8n.
      // El receptor recibe JSON válido — solo cambia el Content-Type header.
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:   JSON.stringify(payload),
      });

      const result = { ok: res.ok, status: res.status, ts: Date.now() };
      this._lastResults.set(webhook.id, result);

      // Notificar a la UI del resultado
      EventBus.emit(EVENTS.WEBHOOK_RESULT, { webhookId: webhook.id, ...result });

      if (import.meta.env.DEV && !res.ok) {
        console.warn(`WebhookManager: ${webhook.name} → HTTP ${res.status}`);
      }
    } catch (err) {
      const result = { ok: false, status: 0, ts: Date.now(), error: err.message };
      this._lastResults.set(webhook.id, result);
      EventBus.emit(EVENTS.WEBHOOK_RESULT, { webhookId: webhook.id, ...result });

      if (import.meta.env.DEV) {
        console.warn(`WebhookManager: ${webhook.name} → ${err.message}`);
      }
    }
  },

  /**
   * Envía un webhook de prueba con un payload de ejemplo.
   * Usado desde WebhookPanel para verificar que la URL funciona.
   * @param {{ id, url, name, events }} webhook
   * @returns {Promise<{ ok: boolean, status: number }>}
   */
  async test(webhook) {
    const payload = {
      event:     'alert.warning',
      timestamp: Date.now(),
      plant:     getPlantId(),
      alert: {
        id:        'test_webhook',
        severity:  'warning',
        sensorIds: ['filter_1_dp'],
        message:   'Test webhook from WTP Digital Twin',
        active:    true,
      },
    };

    try {
      // Usar text/plain evita el preflight CORS (OPTIONS request)
      // que bloquea el body en servicios como webhook.site, Slack, n8n.
      // El receptor recibe JSON válido — solo cambia el Content-Type header.
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:   JSON.stringify(payload),
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  },

  getLastResult(webhookId) {
    return this._lastResults.get(webhookId) ?? null;
  },

  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.RULE_TRIGGERED, this._handler);
      this._handler = null;
    }
  },
};

export default WebhookManager;