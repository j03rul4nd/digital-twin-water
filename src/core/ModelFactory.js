/**
 * ModelFactory.js — Construcción procedural de la planta WTP en Three.js.
 *
 * Inicializado en el paso 1 de init() en main.js, después de SceneManager.
 *
 * REGLAS CRÍTICAS:
 *   1. Todos los meshes usan MeshStandardMaterial — requisito de AlertSystem
 *      para poder usar emissiveIntensity sin condicionales.
 *   2. Los mesh.name deben coincidir EXACTAMENTE con SensorSceneMap.js.
 *   3. Los meshes en estado normal son grises neutros (#666).
 *      El color real llega de ColorMapper en el primer tick.
 *   4. El suelo no tiene nombre de mesh — no es un objeto funcional.
 *
 * Posiciones, dimensiones y layout según Decisión 17 de PRODUCT.md.
 * Sistema de coordenadas: Y vertical, planta en plano XZ, todo a Y >= 0.
 *
 * Layout cenital:
 *   [INLET]    [COAG×2]   [FILTERS×2]  [CHLOR]
 *   X=-18      X=-8,−4    X=4, 8       X=16
 *
 *              [RAW TANK]  [CLEAR TANK] [PUMPS]
 *              X=-6        X=12         X=20
 */

import * as THREE from 'three';
import SceneManager from './SceneManager.js';

// ─── Material base ────────────────────────────────────────────────────────────
// Color neutro industrial. El ColorMapper lo sobreescribe en el primer tick.
// MeshStandardMaterial es obligatorio para que emissive funcione en AlertSystem.
function createMaterial(color = 0x666666) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.2,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
  });
}

// ─── Helpers de construcción ──────────────────────────────────────────────────

/**
 * Crea un mesh de caja y lo posiciona con el fondo en Y = yBase.
 * @param {number} w ancho (X)
 * @param {number} h alto (Y)
 * @param {number} d profundidad (Z)
 * @param {number} x
 * @param {number} yBase — Y del fondo del objeto (no del centro)
 * @param {number} z
 * @param {string} name — mesh.name, debe coincidir con SensorSceneMap
 * @param {number} [color]
 */
function makeBox(w, h, d, x, yBase, z, name, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = createMaterial(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  // BoxGeometry tiene su centro en el origen — desplazamos para que el fondo esté en yBase
  mesh.position.set(x, yBase + h / 2, z);
  return mesh;
}

/**
 * Crea un mesh de cilindro y lo posiciona con el fondo en Y = yBase.
 * @param {number} r radio
 * @param {number} h alto
 * @param {number} x
 * @param {number} yBase
 * @param {number} z
 * @param {string} name
 * @param {number} [color]
 */
function makeCylinder(r, h, x, yBase, z, name, color) {
  const geo = new THREE.CylinderGeometry(r, r, h, 32);
  const mat = createMaterial(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set(x, yBase + h / 2, z);
  return mesh;
}

// ─── ModelFactory ─────────────────────────────────────────────────────────────

const ModelFactory = {
  /**
   * Construye todos los meshes de la planta y los añade a SceneManager.scene.
   * Llamar después de SceneManager.init().
   */
  build() {
    const scene = SceneManager.scene;
    if (!scene) throw new Error('ModelFactory: SceneManager no inicializado.');

    const meshes = [];

    // ── Suelo ────────────────────────────────────────────────────────────────
    // No tiene mesh.name — no es un objeto funcional
    const groundGeo = new THREE.PlaneGeometry(60, 36);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a2a,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 10);
    scene.add(ground);

    // ── Canal de entrada (inlet_flow) ────────────────────────────────────────
    // Decisión 17: BoxGeometry 4×0.5×2 en (-20, 0.25, 10)
    meshes.push(makeBox(4, 0.5, 2, -20, 0, 10, 'mesh_inlet_channel'));

    // Tubería de entrada: cilindro vertical pequeño
    // Decisión 17: CylinderGeometry r=0.3 en (-18, 1, 10)
    meshes.push(makeCylinder(0.3, 2, -18, 0, 10, 'mesh_inlet_pipe'));

    // ── Tanque de agua bruta (raw_turbidity) ─────────────────────────────────
    // Decisión 17: BoxGeometry 6×2×10 en (-6, 1, 14)
    meshes.push(makeBox(6, 2, 10, -6, 0, 14, 'mesh_raw_water_tank'));

    // ── Tanques de coagulación ×2 (coag_ph) ──────────────────────────────────
    // Decisión 17: CylinderGeometry r=1.5 h=3 en (-8, 1.5, 8) y (-4, 1.5, 8)
    meshes.push(makeCylinder(1.5, 3, -8, 0, 8, 'mesh_coag_tank_1'));
    meshes.push(makeCylinder(1.5, 3, -4, 0, 8, 'mesh_coag_tank_2'));

    // Paletas de agitación (decorativas, no funcionales)
    [-8, -4].forEach((x, i) => {
      const padGeo = new THREE.BoxGeometry(0.15, 2.5, 1.2);
      const padMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8, metalness: 0.4 });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(x, 1.5, 8);
      pad.name = `mesh_coag_paddle_${i + 1}`; // no está en SensorSceneMap — solo visual
      scene.add(pad);
    });

    // ── Filtros de arena ×2 (filter_1_dp, filter_2_dp) ───────────────────────
    // Decisión 17: CylinderGeometry r=2 h=3 en (4, 1.5, 8) y (8, 1.5, 8)
    meshes.push(makeCylinder(2, 3, 4, 0, 8, 'mesh_filter_1'));
    meshes.push(makeCylinder(2, 3, 8, 0, 8, 'mesh_filter_2'));

    // Tapa de cada filtro (visual)
    [4, 8].forEach((x, i) => {
      const lidGeo = new THREE.CylinderGeometry(2.1, 2.1, 0.2, 32);
      const lidMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.3 });
      const lid = new THREE.Mesh(lidGeo, lidMat);
      lid.position.set(x, 3.1, 8);
      lid.name = `mesh_filter_lid_${i + 1}`;
      scene.add(lid);
    });

    // ── Tubería de agua filtrada (filtered_turbidity) ─────────────────────────
    // Decisión 17: TubeGeometry r=0.3 de (4,1,8) a (12,1,8)
    const filteredPipeCurve = new THREE.LineCurve3(
      new THREE.Vector3(4, 1, 8),
      new THREE.Vector3(12, 1, 8),
    );
    const filteredPipeGeo = new THREE.TubeGeometry(filteredPipeCurve, 8, 0.3, 12, false);
    const filteredPipeMat = createMaterial();
    const filteredPipeMesh = new THREE.Mesh(filteredPipeGeo, filteredPipeMat);
    filteredPipeMesh.name = 'mesh_filtered_water_pipe';
    meshes.push(filteredPipeMesh);

    // ── Sala de cloración (chlorine_dose) ─────────────────────────────────────
    // Decisión 17: BoxGeometry 4×3×4 en (16, 1.5, 10)
    meshes.push(makeBox(4, 3, 4, 16, 0, 10, 'mesh_chlorination_room'));

    // Tubería de dosificación (visual)
    const doseGeo = new THREE.CylinderGeometry(0.15, 0.15, 2, 12);
    const doseMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.3 });
    const doseMesh = new THREE.Mesh(doseGeo, doseMat);
    doseMesh.position.set(15, 1, 8);
    doseMesh.rotation.z = Math.PI / 2;
    scene.add(doseMesh);

    // ── Clearwell — tanque de almacenamiento (tank_level) ─────────────────────
    // Decisión 17: BoxGeometry 8×3×8 en (12, 1.5, 14)
    meshes.push(makeBox(8, 3, 8, 12, 0, 14, 'mesh_clearwell_tank'));

    // ── Estación de bombeo (outlet_pressure) ──────────────────────────────────
    // Decisión 17: BoxGeometry 3×2.5×3 en (20, 1.25, 10)
    meshes.push(makeBox(3, 2.5, 3, 20, 0, 10, 'mesh_pump_station'));

    // ── Tubería de distribución (residual_chlorine) ────────────────────────────
    // Decisión 17: CylinderGeometry r=0.4 h=6 en (20, 3, 10)
    meshes.push(makeCylinder(0.4, 6, 20, 0, 10, 'mesh_distribution_pipe'));

    // ── Pipes de conexión (decorativos) ──────────────────────────────────────
    // Inlet → Raw tank
    this._addConnector(scene, -18, 0.5, 10, -6, 0.5, 14, 0.2);
    // Raw tank → Coag tanks
    this._addConnector(scene, -6, 0.5, 8, -8, 0.5, 8, 0.2);
    // Coag → Filter
    this._addConnector(scene, -4, 0.5, 8, 4, 0.5, 8, 0.2);
    // Clearwell → Pump station
    this._addConnector(scene, 16, 0.5, 14, 20, 0.5, 10, 0.2);

    // ── Añadir todos los meshes funcionales a la escena ───────────────────────
    meshes.forEach(m => scene.add(m));
  },

  /**
   * Crea una tubería de conexión decorativa entre dos puntos.
   * No tiene nombre de mesh — no es un objeto funcional.
   */
  _addConnector(scene, x1, y1, z1, x2, y2, z2, radius = 0.15) {
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(x1, y1, z1),
      new THREE.Vector3(x2, y2, z2),
    );
    const geo = new THREE.TubeGeometry(curve, 4, radius, 8, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.8,
      metalness: 0.3,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
  },
};

export default ModelFactory;