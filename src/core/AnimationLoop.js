/**
 * AnimationLoop.js — Request Animation Frame loop.
 *
 * Inicializado en el paso 2 de init() en main.js, después de SceneManager.
 * Antes de los módulos de datos (paso 3+) — el primer frame renderiza
 * la escena vacía sin errores.
 *
 * Expone start() y stop(). No necesita destroy() porque no tiene
 * subscripciones al EventBus.
 */

import SceneManager from './SceneManager.js';

const AnimationLoop = {
  /** @type {number | null} ID del requestAnimationFrame en curso */
  _rafId: null,

  /** @type {number} Timestamp del último frame — para calcular delta */
  _lastTime: 0,

  /** @type {boolean} */
  _running: false,

  /**
   * Arranca el loop. Llamar una sola vez desde main.js paso 2.
   * SceneManager debe estar inicializado antes de llamar a start().
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._tick = this._loop.bind(this);
    this._rafId = requestAnimationFrame(this._tick);
  },

  /**
   * Detiene el loop. Llamar si se desmonta la app.
   */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },

  /**
   * Frame loop interno.
   * @param {number} now — timestamp de performance.now() del frame actual
   */
  _loop(now) {
    if (!this._running) return;

    // Delta time en segundos — disponible para animaciones futuras (paletas coag, etc.)
    // const delta = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // Actualizar OrbitControls (necesario si enableDamping = true)
    if (SceneManager.controls) {
      SceneManager.controls.update();
    }

    // Render
    if (SceneManager.renderer && SceneManager.scene && SceneManager.camera) {
      SceneManager.renderer.render(SceneManager.scene, SceneManager.camera);
    }

    this._rafId = requestAnimationFrame(this._tick);
  },
};

export default AnimationLoop;