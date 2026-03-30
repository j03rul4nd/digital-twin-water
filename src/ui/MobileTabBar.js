/**
 * MobileTabBar.js — Barra de navegación inferior para móvil.
 *
 * Solo activo cuando el viewport es <= 768px.
 * Gestiona la apertura/cierre de los paneles izquierdo y derecho
 * como bottom sheets deslizables.
 *
 * Tabs disponibles:
 *   3D      — cierra todos los paneles, vista limpia de la escena
 *   Sensors — abre el panel izquierdo (TelemetryPanel)
 *   Alerts  — abre el panel derecho (AlertPanel + MQTT + Minimap)
 *   Connect — abre directamente el ConfigModal
 *
 * Inicializar en el paso 4 de init() en main.js, después de MiniMap.
 *
 * NOTA: Este módulo solo inyecta DOM y gestiona clases CSS.
 * Las transiciones las hace el CSS con transform: translateY.
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import MiniMap     from './MiniMap.js';
import ConfigModal from './ConfigModal.js';

const MOBILE_BREAKPOINT = 768;

const MobileTabBar = {
  /** @type {HTMLElement | null} */
  _bar: null,

  /** @type {HTMLElement | null} */
  _overlay: null,

  /** @type {'none' | 'sensors' | 'alerts'} */
  _activePanel: 'none',

  /** @type {Function[]} */
  _handlers: [],

  /** @type {number} — contador de alertas activas para el badge */
  _alertCount: 0,

  init() {
    // Solo activo en móvil — pero siempre se inyecta el DOM
    // para que los media queries puedan mostrarlo/ocultarlo
    this._inject();
    this._bindEvents();
    this._bindAlertBadge();
    this._watchBreakpoint();
  },

  // ─── Inyección del DOM ───────────────────────────────────────────────────────

  _inject() {
    // Overlay de fondo
    const overlay = document.createElement('div');
    overlay.id = 'mobile-overlay';
    overlay.addEventListener('click', () => this._closeAll());
    document.body.appendChild(overlay);
    this._overlay = overlay;

    // Tab bar
    const bar = document.createElement('div');
    bar.id = 'mobile-tab-bar';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Dashboard navigation');

    bar.innerHTML = `
      <button class="mobile-tab is-active" data-tab="scene" role="tab" aria-selected="true">
        <span class="mobile-tab-icon">🏭</span>
        <span class="mobile-tab-label">3D View</span>
      </button>
      <button class="mobile-tab" data-tab="sensors" role="tab" aria-selected="false">
        <span class="mobile-tab-icon">📡</span>
        <span class="mobile-tab-label">Sensors</span>
      </button>
      <button class="mobile-tab" data-tab="alerts" role="tab" aria-selected="false">
        <span class="mobile-tab-icon">🔔</span>
        <span class="mobile-tab-label">Alerts</span>
        <span class="mobile-tab-badge" id="mobile-alert-badge"></span>
      </button>
      <button class="mobile-tab" data-tab="connect" role="tab" aria-selected="false">
        <span class="mobile-tab-icon">⚡</span>
        <span class="mobile-tab-label">Connect</span>
      </button>
    `;

    document.body.appendChild(bar);
    this._bar = bar;
  },

  // ─── Binding de eventos ──────────────────────────────────────────────────────

  _bindEvents() {
    if (!this._bar) return;

    this._bar.querySelectorAll('.mobile-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        this._onTab(name);
      });
    });
  },

  _onTab(name) {
    switch (name) {
      case 'scene':
        this._closeAll();
        break;
      case 'sensors':
        this._toggle('sensors');
        break;
      case 'alerts':
        this._toggle('alerts');
        break;
      case 'connect':
        // El tab de connect no abre un panel — abre el ConfigModal directamente
        this._closeAll();
        ConfigModal.open();
        break;
    }

    this._updateTabActive(name === 'connect' ? 'scene' : name);
  },

  // ─── Gestión de panels ───────────────────────────────────────────────────────

  _toggle(panelName) {
    if (this._activePanel === panelName) {
      this._closeAll();
    } else {
      this._openPanel(panelName);
    }
  },

  _openPanel(panelName) {
    this._activePanel = panelName;

    const left  = document.getElementById('panel-left');
    const right = document.getElementById('panel-right');

    // Cerrar ambos primero
    left?.classList.remove('mobile-open');
    right?.classList.remove('mobile-open');

    if (panelName === 'sensors') {
      left?.classList.add('mobile-open');
    } else if (panelName === 'alerts') {
      right?.classList.add('mobile-open');
      // Invalidar el mapa después de la transición CSS (300ms)
      setTimeout(() => {
        MiniMap.invalidate();
      }, 350);
    }

    this._overlay?.classList.add('visible');
    this._lockBodyScroll(true);
  },

  _closeAll() {
    this._activePanel = 'none';

    const left  = document.getElementById('panel-left');
    const right = document.getElementById('panel-right');

    left?.classList.remove('mobile-open');
    right?.classList.remove('mobile-open');

    this._overlay?.classList.remove('visible');
    this._lockBodyScroll(false);
    this._updateTabActive('scene');
  },

  // ─── Estado de tabs ──────────────────────────────────────────────────────────

  _updateTabActive(activeName) {
    if (!this._bar) return;

    this._bar.querySelectorAll('.mobile-tab').forEach(tab => {
      const isActive = tab.dataset.tab === activeName;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  },

  // ─── Badge de alertas ────────────────────────────────────────────────────────

  _bindAlertBadge() {
    const onAlert = (alert) => {
      if (alert.active) {
        this._alertCount++;
      } else {
        this._alertCount = Math.max(0, this._alertCount - 1);
      }
      this._updateBadge();
    };

    EventBus.on(EVENTS.RULE_TRIGGERED, onAlert);
    this._handlers.push([EVENTS.RULE_TRIGGERED, onAlert]);
  },

  _updateBadge() {
    const badge = document.getElementById('mobile-alert-badge');
    if (!badge) return;

    if (this._alertCount > 0) {
      badge.textContent = this._alertCount > 9 ? '9+' : String(this._alertCount);
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  },

  // ─── Utilidades ─────────────────────────────────────────────────────────────

  /**
   * Previene el scroll del body cuando un panel está abierto en móvil.
   * Solo en móvil — en desktop no tiene efecto.
   */
  _lockBodyScroll(lock) {
    if (window.innerWidth > MOBILE_BREAKPOINT) return;
    document.body.style.overflow = lock ? 'hidden' : '';
  },

  /**
   * Observa cambios de breakpoint para limpiar estado al pasar a desktop.
   */
  _watchBreakpoint() {
    if (typeof window.matchMedia === 'undefined') return;

    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = (e) => {
      if (!e.matches) {
        // Pasamos a desktop — limpiar todo el estado móvil
        this._closeAll();
        document.body.style.overflow = '';
      }
    };

    // API moderna
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
    } else {
      // Fallback para Safari < 14
      mq.addListener(onChange);
    }
  },

  destroy() {
    this._handlers.forEach(([e, fn]) => EventBus.off(e, fn));
    this._handlers = [];
    this._bar?.remove();
    this._overlay?.remove();
    this._bar    = null;
    this._overlay = null;
    document.body.style.overflow = '';
  },
};

export default MobileTabBar;