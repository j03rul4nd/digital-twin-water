/**
 * SceneManager.js — Setup de Three.js: renderer, escena, cámara y luces.
 *
 * Inicializado en el paso 1 de init() en main.js.
 * Debe existir antes de ModelFactory y AnimationLoop.
 *
 * Expone: renderer, scene, camera — usados por AnimationLoop y ModelFactory.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SceneManager = {
  /** @type {THREE.WebGLRenderer} */
  renderer: null,

  /** @type {THREE.Scene} */
  scene: null,

  /** @type {THREE.PerspectiveCamera} */
  camera: null,

  /** @type {OrbitControls} */
  controls: null,

  /**
   * Inicializa el renderer, la escena, la cámara, las luces y los controles.
   * El canvas se monta en el elemento #viewport del DOM.
   * @returns {Promise<void>}
   */
  async init() {
    const container = document.getElementById('viewport');
    if (!container) throw new Error('SceneManager: no se encontró #viewport en el DOM.');

    // ─── Renderer ────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,           // fondo transparente — se funde con --bg del CSS
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0b0e12, 1);
    this.renderer.shadowMap.enabled = false; // ModelFactory lo activa con sombras soft
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // ─── Escena ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e12);

    // ─── Cámara ───────────────────────────────────────────────────────────────
    // Ángulo ligeramente más bajo y lateral — más cinematográfico que isométrico puro
    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    );
    this.camera.position.set(-5, 18, 32);
    this.camera.lookAt(1, 0, 10);

    // ─── Luces base mínimas ───────────────────────────────────────────────────
    // ModelFactory añade el setup completo de iluminación en build().
    // Aquí solo ponemos lo mínimo para que el primer frame no sea negro.
    const ambient = new THREE.AmbientLight(0x1a2535, 1.0);
    this.scene.add(ambient);

    // ─── OrbitControls ────────────────────────────────────────────────────────
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;      // suaviza el movimiento de cámara
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 10;          // no permite acercarse demasiado
    this.controls.maxDistance = 80;          // ni alejarse demasiado
    this.controls.maxPolarAngle = Math.PI / 2.1; // no permite pasar por debajo del suelo
    this.controls.target.set(0, 0, 10);     // pivota sobre el centro de la planta
    this.controls.update();

    // ─── Resize handler ───────────────────────────────────────────────────────
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
  },

  /**
   * Actualiza el renderer y la cámara cuando cambia el tamaño de la ventana.
   * Llamado automáticamente por el listener de resize.
   */
  _handleResize() {
    const container = document.getElementById('viewport');
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this.controls) this.controls.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
  },
};

export default SceneManager;