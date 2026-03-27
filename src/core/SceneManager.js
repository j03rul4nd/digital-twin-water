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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap a 2x
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x000000, 0);  // transparente, el CSS pone el fondo
    this.renderer.shadowMap.enabled = false;   // sin sombras — no las necesitamos y cuestan GPU
    container.appendChild(this.renderer.domElement);

    // ─── Escena ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = null; // transparente

    // ─── Cámara ───────────────────────────────────────────────────────────────
    // Vista isométrica aproximada que muestra toda la planta sin recortar.
    // Decisión 17 de PRODUCT.md: position(0, 22, 30), lookAt(0, 0, 10)
    this.camera = new THREE.PerspectiveCamera(
      45,                                              // FOV
      container.clientWidth / container.clientHeight,  // aspect ratio
      0.1,                                             // near
      500,                                             // far
    );
    this.camera.position.set(0, 22, 30);
    this.camera.lookAt(0, 0, 10);

    // ─── Luces ────────────────────────────────────────────────────────────────
    // Decisión 17: AmbientLight(0xffffff, 0.4) + DirectionalLight(0xffffff, 0.8)
    // Sencillo pero suficiente para que MeshStandardMaterial muestre
    // los colores de ColorMapper correctamente.

    // Luz ambiental base — evita sombras completamente negras
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Luz direccional principal — simula sol desde arriba-derecha
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 10);
    this.scene.add(sun);

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