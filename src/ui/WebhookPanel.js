/**
 * WebhookPanel.js — Panel de gestión de webhooks.
 *
 * Modal accesible desde un botón en el topbar (⚡ Webhooks).
 * Permite añadir, editar, habilitar/deshabilitar y probar webhooks.
 *
 * Cada webhook tiene:
 *   - URL destino
 *   - Nombre descriptivo
 *   - Eventos a escuchar (alert.danger, alert.warning, alert.resolved)
 *   - Estado enabled/disabled
 *
 * El botón de test envía un payload de ejemplo y muestra el resultado.
 */

import EventBus          from '../core/EventBus.js';
import { EVENTS }        from '../core/events.js';
import WebhookManager, {
  loadWebhooks,
  saveWebhooks,
} from '../utils/WebhookManager.js';

const WebhookPanel = {
  _overlay:  null,
  _handlers: [],

  init() {
    this._build();

    // Actualizar indicadores de resultado cuando llegan
    const onResult = ({ webhookId, ok, status }) => {
      this._updateResult(webhookId, ok, status);
    };
    EventBus.on(EVENTS.WEBHOOK_RESULT, onResult);
    this._handlers.push([EVENTS.WEBHOOK_RESULT, onResult]);

    // Botón del topbar
    const btn = document.getElementById('btn-webhooks');
    if (btn) btn.addEventListener('click', () => this.open());
  },

  open() {
    this._renderList();
    this._overlay.classList.add('visible');
  },

  close() {
    this._overlay.classList.remove('visible');
  },

  // ─── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'webhook-overlay';
    el.innerHTML = `
      <div id="webhook-modal" role="dialog">
        <div id="wh-header">
          <span id="wh-title">Webhooks</span>
          <button id="wh-close">✕</button>
        </div>
        <div id="wh-body">
          <div id="wh-list"></div>
          <button id="wh-add-btn" class="wh-add-btn">+ Add webhook</button>
          <div id="wh-form" style="display:none;">
            <div class="wh-form-field">
              <label class="wh-label">Name</label>
              <input class="wh-input" id="wh-form-name" type="text" placeholder="e.g. Slack alerts" />
            </div>
            <div class="wh-form-field">
              <label class="wh-label">URL</label>
              <input class="wh-input" id="wh-form-url" type="text" placeholder="https://hooks.slack.com/..." />
              <span class="wh-hint">POST with JSON payload. Target must allow CORS from browser.</span>
            </div>
            <div class="wh-form-field">
              <label class="wh-label">Trigger on</label>
              <div class="wh-checkboxes">
                <label class="wh-check"><input type="checkbox" value="alert.danger"   checked /> Danger alerts</label>
                <label class="wh-check"><input type="checkbox" value="alert.warning"  checked /> Warning alerts</label>
                <label class="wh-check"><input type="checkbox" value="alert.resolved" />         Alert resolved</label>
              </div>
            </div>
            <div id="wh-form-status"></div>
            <div class="wh-form-actions">
              <button id="wh-form-cancel" class="wh-btn-ghost">Cancel</button>
              <button id="wh-form-test"   class="wh-btn-ghost">Test →</button>
              <button id="wh-form-save"   class="wh-btn-primary">Save</button>
            </div>
          </div>
        </div>
        <div id="wh-footer">
          <span class="wh-hint">
            Works with Slack, Discord, n8n, Make, Zapier, or any URL accepting POST JSON.
            <a href="https://github.com/j03rul4nd/digital-twin-water#webhooks" target="_blank" class="wh-link">Docs ↗</a>
          </span>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('visible')) this.close();
    });

    document.getElementById('wh-close').addEventListener('click', () => this.close());

    document.getElementById('wh-add-btn').addEventListener('click', () => {
      this._showForm(null);
    });

    document.getElementById('wh-form-cancel').addEventListener('click', () => {
      this._hideForm();
    });

    document.getElementById('wh-form-test').addEventListener('click', () => {
      this._testForm();
    });

    document.getElementById('wh-form-save').addEventListener('click', () => {
      this._saveForm();
    });
  },

  // ─── Lista de webhooks ──────────────────────────────────────────────────────

  _renderList() {
    const list = document.getElementById('wh-list');
    if (!list) return;

    const webhooks = loadWebhooks();
    list.innerHTML = '';

    if (webhooks.length === 0) {
      list.innerHTML = `<div class="wh-empty">No webhooks configured yet.</div>`;
      return;
    }

    webhooks.forEach(wh => {
      const item = document.createElement('div');
      item.className = 'wh-item';
      item.dataset.id = wh.id;

      const lastResult = WebhookManager.getLastResult(wh.id);
      const resultDot  = lastResult
        ? `<span class="wh-result-dot ${lastResult.ok ? 'ok' : 'fail'}" title="${lastResult.ok ? 'Last call OK' : `Error ${lastResult.status}`}"></span>`
        : '';

      item.innerHTML = `
        <div class="wh-item-left">
          <label class="wh-toggle">
            <input type="checkbox" ${wh.enabled ? 'checked' : ''} data-toggle="${wh.id}" />
            <span class="wh-toggle-track"></span>
          </label>
          <div class="wh-item-info">
            <div class="wh-item-name">${wh.name}</div>
            <div class="wh-item-url">${this._truncateUrl(wh.url)}</div>
            <div class="wh-item-events">${wh.events.join(' · ')}</div>
          </div>
        </div>
        <div class="wh-item-right">
          ${resultDot}
          <button class="wh-btn-icon" data-edit="${wh.id}" title="Edit">✎</button>
          <button class="wh-btn-icon wh-btn-delete" data-delete="${wh.id}" title="Delete">✕</button>
        </div>
      `;

      list.appendChild(item);
    });

    // Event listeners de la lista
    list.querySelectorAll('[data-toggle]').forEach(input => {
      input.addEventListener('change', (e) => {
        this._toggleWebhook(e.target.dataset.toggle, e.target.checked);
      });
    });

    list.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const wh = loadWebhooks().find(w => w.id === e.target.dataset.edit);
        if (wh) this._showForm(wh);
      });
    });

    list.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this._deleteWebhook(e.target.dataset.delete);
      });
    });
  },

  // ─── Formulario ─────────────────────────────────────────────────────────────

  /** @type {string|null} ID del webhook siendo editado (null = nuevo) */
  _editingId: null,

  _showForm(webhook) {
    this._editingId = webhook?.id ?? null;

    document.getElementById('wh-form-name').value = webhook?.name ?? '';
    document.getElementById('wh-form-url').value  = webhook?.url  ?? '';

    const checkboxes = document.querySelectorAll('#wh-form .wh-checkboxes input');
    checkboxes.forEach(cb => {
      cb.checked = webhook?.events?.includes(cb.value) ?? (cb.value !== 'alert.resolved');
    });

    this._setFormStatus('idle');
    document.getElementById('wh-add-btn').style.display = 'none';
    document.getElementById('wh-form').style.display    = 'block';
    document.getElementById('wh-form-name').focus();
  },

  _hideForm() {
    this._editingId = null;
    document.getElementById('wh-add-btn').style.display = 'block';
    document.getElementById('wh-form').style.display    = 'none';
    this._setFormStatus('idle');
  },

  _saveForm() {
    const name = document.getElementById('wh-form-name').value.trim();
    const url  = document.getElementById('wh-form-url').value.trim();
    const events = Array.from(document.querySelectorAll('#wh-form .wh-checkboxes input:checked'))
      .map(cb => cb.value);

    if (!name) { this._setFormStatus('error', 'Name is required'); return; }
    if (!url)  { this._setFormStatus('error', 'URL is required'); return; }
    if (!url.startsWith('http')) { this._setFormStatus('error', 'URL must start with http:// or https://'); return; }
    if (events.length === 0)  { this._setFormStatus('error', 'Select at least one event'); return; }

    const webhooks = loadWebhooks();

    if (this._editingId) {
      const idx = webhooks.findIndex(w => w.id === this._editingId);
      if (idx !== -1) webhooks[idx] = { ...webhooks[idx], name, url, events };
    } else {
      webhooks.push({
        id:      `wh_${Date.now()}`,
        name, url, events,
        enabled: true,
      });
    }

    saveWebhooks(webhooks);
    this._hideForm();
    this._renderList();
  },

  async _testForm() {
    const url  = document.getElementById('wh-form-url').value.trim();
    const name = document.getElementById('wh-form-name').value.trim() || 'Test';

    if (!url) { this._setFormStatus('error', 'Enter a URL first'); return; }

    this._setFormStatus('loading', 'Sending test…');
    const result = await WebhookManager.test({ id: 'test', url, name, events: ['alert.warning'] });

    if (result.ok) {
      this._setFormStatus('success', `✓ Received HTTP ${result.status}`);
    } else {
      this._setFormStatus('error', result.error ?? `HTTP ${result.status} — check CORS settings`);
    }
  },

  _setFormStatus(state, msg = '') {
    const el = document.getElementById('wh-form-status');
    if (!el) return;
    const colors = { idle: '', loading: 'var(--text2)', success: 'var(--green)', error: 'var(--red)' };
    el.textContent  = msg;
    el.style.color  = colors[state] ?? '';
    el.style.display = state === 'idle' ? 'none' : 'block';
  },

  // ─── Acciones ───────────────────────────────────────────────────────────────

  _toggleWebhook(id, enabled) {
    const webhooks = loadWebhooks();
    const wh = webhooks.find(w => w.id === id);
    if (wh) { wh.enabled = enabled; saveWebhooks(webhooks); }
  },

  _deleteWebhook(id) {
    const webhooks = loadWebhooks().filter(w => w.id !== id);
    saveWebhooks(webhooks);
    this._renderList();
  },

  _updateResult(webhookId, ok, status) {
    const dot = document.querySelector(`[data-id="${webhookId}"] .wh-result-dot`);
    if (dot) {
      dot.className = `wh-result-dot ${ok ? 'ok' : 'fail'}`;
      dot.title = ok ? `Last call OK (${status})` : `Error ${status}`;
    }
  },

  _truncateUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 20 ? u.pathname.slice(0, 20) + '…' : u.pathname;
      return u.hostname + path;
    } catch { return url.slice(0, 35) + '…'; }
  },

  destroy() {
    this._handlers.forEach(([e, fn]) => EventBus.off(e, fn));
    this._handlers = [];
    this._overlay?.remove();
    this._overlay = null;
  },
};

export default WebhookPanel;