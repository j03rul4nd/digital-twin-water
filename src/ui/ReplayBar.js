/**
 * ReplayBar.js — Scrubber UI for replay mode.
 *
 * DOM:
 *   #replay-bar            — bottom-fixed container (z-index 150)
 *     #replay-track-wrap   — range input + SVG overlay con marcadores de alerta
 *     #replay-meta         — timestamp absoluto + delta "Xm Ys ago"
 *     #replay-actions      — ▶ Play (4x) / ✕ Back to Live
 *   #replay-badge          — pill "REPLAY" en top-right del viewport
 *
 * Visibilidad:
 *   Siempre presente en el DOM. Se muestra/oculta con opacity + pointer-events
 *   (no display: none) para que la entrada/salida pueda tener transición.
 *   Transición: opacity 0.15s ease + translateY(100% → 0) 0.2s ease.
 *
 * Teclado (solo si no hay input enfocado ni modal abierto):
 *   R        → toggle replay
 *   ← / →    → step ±1 frame
 *   Space    → play/pause
 *   Escape   → exit
 *
 * Playback:
 *   125ms/frame = 4x la tasa live (500ms/frame)
 *   Al llegar al último frame, pausa automáticamente.
 */

import EventBus       from '../core/EventBus.js';
import { EVENTS }     from '../core/events.js';
import ReplayController from '../core/ReplayController.js';
import SensorState    from '../sensors/SensorState.js';
import EventMarkers   from '../charts/EventMarkers.js';

const PLAY_INTERVAL_MS = 125; // 4× la tasa live (500ms/frame)

const ReplayBar = {
  _root:       null,
  _badge:      null,
  _range:      null,
  _markerSvg:  null,
  _metaEl:     null,
  _playBtn:    null,
  _exitBtn:    null,
  _playTimer:  null,
  _tickTimer:  null,   // refresca "Xm Ys ago" cada segundo
  _handlers:   [],
  _isPlaying:  false,
  _keyHandler: null,
  _unsubscribeCtrl: null,

  init() {
    this._build();
    this._injectStyles();
    this._wireEvents();
    this._subscribeController();
    this._subscribeEventBus();
    this._bindKeyboard();

    // Estado inicial: oculto
    this._applyVisibility(false);
  },

  // ─── DOM ─────────────────────────────────────────────────────────────────────

  _build() {
    // Badge superior
    const badge = document.createElement('div');
    badge.id = 'replay-badge';
    badge.textContent = 'REPLAY';
    document.body.appendChild(badge);
    this._badge = badge;

    // Bar inferior
    const bar = document.createElement('div');
    bar.id = 'replay-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Replay timeline');
    bar.innerHTML = `
      <div id="replay-track-wrap">
        <input id="replay-range" type="range" min="0" max="0" step="1" value="0"
               aria-label="Scrub through session history"/>
        <svg id="replay-marker-overlay" aria-hidden="true"
             preserveAspectRatio="none" viewBox="0 0 100 20"></svg>
      </div>
      <div id="replay-meta">
        <span id="replay-timestamp">—</span>
        <span id="replay-delta">—</span>
      </div>
      <div id="replay-actions">
        <button id="replay-play-btn" class="replay-btn" title="Play at 4× speed">▶ Play</button>
        <button id="replay-exit-btn" class="replay-btn replay-btn--primary" title="Exit replay">✕ Back to Live</button>
      </div>
    `;
    document.body.appendChild(bar);

    this._root      = bar;
    this._range     = bar.querySelector('#replay-range');
    this._markerSvg = bar.querySelector('#replay-marker-overlay');
    this._metaEl    = bar.querySelector('#replay-meta');
    this._playBtn   = bar.querySelector('#replay-play-btn');
    this._exitBtn   = bar.querySelector('#replay-exit-btn');
  },

  // ─── Events ──────────────────────────────────────────────────────────────────

  _wireEvents() {
    // Scrubber
    this._range.addEventListener('input', (e) => {
      this._stopPlayback();
      const idx = parseInt(e.target.value, 10);
      ReplayController.scrubTo(idx);
    });

    // Play/Pause
    this._playBtn.addEventListener('click', () => this._togglePlayback());

    // Exit
    this._exitBtn.addEventListener('click', () => ReplayController.exit());
  },

  _subscribeController() {
    this._unsubscribeCtrl = ReplayController.subscribe(({ active, index }) => {
      if (active) {
        this._onEnterOrScrub(index);
      } else {
        this._onExit();
      }
    });
  },

  _subscribeEventBus() {
    // No necesitamos reescuchar REPLAY_* aquí (ya lo capta subscribe()),
    // pero el Toolbar y otros consumidores sí. ReplayBar se mantiene reactivo
    // únicamente vía subscribe() del controller.
  },

  // ─── Replay lifecycle ────────────────────────────────────────────────────────

  _onEnterOrScrub(index) {
    this._applyVisibility(true);

    const len = SensorState.history.length;
    this._range.max = String(Math.max(0, len - 1));
    this._range.value = String(index ?? 0);

    this._renderMarkers();
    this._renderMeta(index);

    // Auto-pause cuando llegamos al final en modo play
    if (this._isPlaying && index >= len - 1) {
      this._stopPlayback();
    }

    // Refresca "Xm Ys ago" cada segundo
    this._startTicker();
  },

  _onExit() {
    this._stopPlayback();
    this._stopTicker();
    this._applyVisibility(false);
  },

  _applyVisibility(visible) {
    if (!this._root || !this._badge) return;

    if (visible) {
      this._root.classList.add('is-visible');
      this._badge.classList.add('is-visible');
    } else {
      this._root.classList.remove('is-visible');
      this._badge.classList.remove('is-visible');
    }
  },

  // ─── Meta: timestamp + delta ─────────────────────────────────────────────────

  _renderMeta(index) {
    const frame = SensorState.history[index];
    if (!frame) {
      document.getElementById('replay-timestamp').textContent = '—';
      document.getElementById('replay-delta').textContent     = '—';
      return;
    }

    const tsEl = document.getElementById('replay-timestamp');
    if (tsEl) {
      const d = new Date(frame.timestamp);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      tsEl.textContent = `${hh}:${mm}:${ss}`;
    }

    const deltaEl = document.getElementById('replay-delta');
    if (deltaEl) {
      const ageSec = Math.floor((Date.now() - frame.timestamp) / 1000);
      deltaEl.textContent = this._formatAgo(ageSec);
    }
  },

  _formatAgo(sec) {
    if (sec < 5)     return 'now';
    if (sec < 60)    return `${sec}s ago`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, '0')}s ago`;
  },

  _startTicker() {
    if (this._tickTimer !== null) return;
    this._tickTimer = setInterval(() => {
      if (!ReplayController.isActive()) return;
      const snap = ReplayController.getSnapshot();
      if (!snap) return;
      this._renderMeta(snap.index);
    }, 1000);
  },

  _stopTicker() {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  },

  // ─── Alert markers overlay ───────────────────────────────────────────────────

  _renderMarkers() {
    if (!this._markerSvg) return;
    const len = SensorState.history.length;
    if (len < 2) { this._markerSvg.innerHTML = ''; return; }

    const firstTs = SensorState.history[0].timestamp;
    const lastTs  = SensorState.history[len - 1].timestamp;
    const span    = Math.max(1, lastTs - firstTs);

    const markers = EventMarkers.getInRange(firstTs, lastTs)
      .filter(m => m.type === 'alert');

    // viewBox es 100×20 — mapeamos timestamp → x ∈ [0..100]
    const NS = 'http://www.w3.org/2000/svg';
    this._markerSvg.innerHTML = '';
    for (const m of markers) {
      const frac = (m.timestamp - firstTs) / span;
      const x    = Math.max(0, Math.min(100, frac * 100));
      const col  = m.severity === 'danger' ? 'var(--red)' : 'var(--amber)';

      const flag = document.createElementNS(NS, 'rect');
      flag.setAttribute('x', x.toFixed(2));
      flag.setAttribute('y', '0');
      flag.setAttribute('width', '0.35');
      flag.setAttribute('height', '20');
      flag.setAttribute('fill', col);
      flag.setAttribute('opacity', '0.75');
      this._markerSvg.appendChild(flag);

      // Banderita arriba
      const tri = document.createElementNS(NS, 'circle');
      tri.setAttribute('cx', x.toFixed(2));
      tri.setAttribute('cy', '2');
      tri.setAttribute('r', '1.3');
      tri.setAttribute('fill', col);
      this._markerSvg.appendChild(tri);
    }
  },

  // ─── Playback ────────────────────────────────────────────────────────────────

  _togglePlayback() {
    if (this._isPlaying) this._stopPlayback();
    else                 this._startPlayback();
  },

  _startPlayback() {
    if (!ReplayController.isActive()) return;
    const len = SensorState.history.length;
    if (len === 0) return;

    this._isPlaying = true;
    this._playBtn.textContent = '❚❚ Pause';
    this._playBtn.classList.add('is-active');

    this._playTimer = setInterval(() => {
      const snap = ReplayController.getSnapshot();
      if (!snap) { this._stopPlayback(); return; }

      const nextIdx = snap.index + 1;
      const maxIdx  = SensorState.history.length - 1;

      if (nextIdx > maxIdx) {
        this._stopPlayback();
        return;
      }
      ReplayController.scrubTo(nextIdx);
    }, PLAY_INTERVAL_MS);
  },

  _stopPlayback() {
    this._isPlaying = false;
    if (this._playBtn) {
      this._playBtn.textContent = '▶ Play';
      this._playBtn.classList.remove('is-active');
    }
    if (this._playTimer !== null) {
      clearInterval(this._playTimer);
      this._playTimer = null;
    }
  },

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────

  _bindKeyboard() {
    this._keyHandler = (e) => {
      // No interceptar si el usuario está escribiendo en un input, textarea,
      // select, o tiene un contenteditable enfocado.
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target && e.target.isContentEditable) return;

      // Si hay un modal abierto (no el replay bar) no hacer nada
      if (this._isModalOpen()) return;

      // Toggle siempre posible
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (ReplayController.isActive()) ReplayController.exit();
        else                             ReplayController.enter();
        return;
      }

      // Resto solo en modo activo
      if (!ReplayController.isActive()) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this._stopPlayback();
        const snap = ReplayController.getSnapshot();
        if (snap) ReplayController.scrubTo(snap.index - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this._stopPlayback();
        const snap = ReplayController.getSnapshot();
        if (snap) ReplayController.scrubTo(snap.index + 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        this._togglePlayback();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        ReplayController.exit();
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  },

  _isModalOpen() {
    // Modales conocidos del proyecto que, si están visibles, deben
    // absorber las teclas. El replay bar no se considera un modal.
    const selectors = [
      '#sensor-detail-overlay.visible',
      '#config-modal.visible',
      '#mqtt-modal.visible',
      '#startup-modal',                 // siempre presente mientras bloquea
      '.modal-overlay.visible',
    ];
    for (const sel of selectors) {
      if (document.querySelector(sel)) return true;
    }
    return false;
  },

  // ─── Styles ──────────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('replay-bar-styles')) return;

    const style = document.createElement('style');
    style.id = 'replay-bar-styles';
    style.textContent = `
      /* ── ReplayBar ──────────────────────────────────────────────────────── */

      #replay-bar {
        position: fixed;
        left: 0; right: 0; bottom: 0;
        z-index: 150;
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 16px;
        background: var(--bg1);
        border-top: 1px solid var(--line);
        font-family: 'IBM Plex Sans', sans-serif;
        color: var(--text1);
        opacity: 0;
        pointer-events: none;
        transform: translateY(100%);
        transition: opacity 0.15s ease, transform 0.2s ease;
      }

      #replay-bar.is-visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      #replay-track-wrap {
        position: relative;
        flex: 1 1 auto;
        height: 28px;
        display: flex;
        align-items: center;
      }

      #replay-marker-overlay {
        position: absolute;
        left: 0; right: 0;
        top: 4px;
        height: 20px;
        width: 100%;
        pointer-events: none;
      }

      #replay-range {
        width: 100%;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: var(--line2);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      #replay-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px; height: 14px;
        background: var(--red);
        border: 2px solid var(--bg);
        border-radius: 50%;
        cursor: grab;
        transition: transform 0.15s ease;
      }

      #replay-range::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.15); }

      #replay-range::-moz-range-thumb {
        width: 14px; height: 14px;
        background: var(--red);
        border: 2px solid var(--bg);
        border-radius: 50%;
        cursor: grab;
      }

      #replay-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        min-width: 120px;
        font-family: 'JetBrains Mono', monospace;
      }

      #replay-timestamp {
        font-size: 12px;
        color: var(--text0);
        font-weight: 500;
      }

      #replay-delta {
        font-size: 10px;
        color: var(--text2);
      }

      #replay-actions {
        display: flex;
        gap: 8px;
      }

      .replay-btn {
        padding: 5px 11px;
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 11px;
        color: var(--text1);
        background: transparent;
        border: 1px solid var(--line2);
        border-radius: 4px;
        cursor: pointer;
        transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      }
      .replay-btn:hover      { color: var(--text0); border-color: var(--text2); }
      .replay-btn.is-active  { color: var(--red); border-color: var(--red); }

      .replay-btn--primary {
        color: var(--red);
        border-color: rgba(239,68,68,0.35);
        background: var(--red-bg);
      }
      .replay-btn--primary:hover {
        color: var(--red);
        border-color: var(--red);
        background: rgba(239,68,68,0.14);
      }

      /* ── REPLAY badge (top-right pill) ─────────────────────────────────── */
      #replay-badge {
        position: fixed;
        top: 12px;
        right: 16px;
        z-index: 150;
        padding: 3px 8px;
        background: var(--red-bg);
        color: var(--red);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 4px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }

      #replay-badge.is-visible {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  },

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  destroy() {
    this._stopPlayback();
    this._stopTicker();
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._unsubscribeCtrl) {
      this._unsubscribeCtrl();
      this._unsubscribeCtrl = null;
    }
    this._handlers.forEach(([event, handler]) => EventBus.off(event, handler));
    this._handlers = [];

    this._root?.remove();
    this._badge?.remove();
    document.getElementById('replay-bar-styles')?.remove();
    this._root = this._badge = this._range = this._markerSvg = null;
    this._metaEl = this._playBtn = this._exitBtn = null;
  },
};

export default ReplayBar;
