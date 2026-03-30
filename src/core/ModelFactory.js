/**
 * ModelFactory.js — Planta WTP procedural con mejoras visuales.
 */

import * as THREE from 'three';
import SceneManager from './SceneManager.js';

// ─── Paleta de materiales ─────────────────────────────────────────────────────

function makeMat(color, roughness, metalness, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness, metalness,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
    ...extra,
  });
}

const MAT = {
  functional: () => makeMat(0x7a8a9a, 0.65, 0.35),
  steel:      () => makeMat(0x8a9aaa, 0.30, 0.80),
  concrete:   () => makeMat(0x6a7070, 0.95, 0.00),
  ground:     () => makeMat(0x232b28, 0.98, 0.00),
  darkMetal:  () => makeMat(0x3a3f44, 0.70, 0.60),
  safety:     () => makeMat(0xd4a017, 0.60, 0.10),
  clearwell:  () => makeMat(0x8a9a8c, 0.92, 0.05),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shadow(mesh) {
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeBox(w, h, d, x, yBase, z, name, matFn = MAT.functional) {
  const mesh = shadow(new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    matFn(),
  ));
  mesh.name = name;
  mesh.position.set(x, yBase + h / 2, z);
  return mesh;
}

function makeCylinder(rTop, rBot, h, x, yBase, z, name, matFn = MAT.functional, segs = 32) {
  const mesh = shadow(new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, segs),
    matFn(),
  ));
  mesh.name = name;
  mesh.position.set(x, yBase + h / 2, z);
  return mesh;
}

function makePipe(from, to, r = 0.18, matFn = MAT.steel) {
  const curve = new THREE.LineCurve3(
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  );
  const mesh = shadow(new THREE.Mesh(
    new THREE.TubeGeometry(curve, 6, r, 10, false),
    matFn(),
  ));
  return mesh;
}

function makePipeSupport(x, z, h = 1.2) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, h, 8),
    MAT.darkMetal(),
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  return mesh;
}

function makeValve(x, y, z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 8),
    MAT.steel(),
  );
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),
    MAT.safety(),
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.x = 0.3;
  group.add(body);
  group.add(handle);
  group.position.set(x, y, z);
  group.castShadow = true;
  return group;
}

function makeStairs(x, z, h = 3) {
  const group = new THREE.Group();
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, 0.3),
      MAT.darkMetal(),
    );
    step.position.set(0, (i / steps) * h, -i * 0.3);
    step.castShadow = true;
    group.add(step);
  }
  const rail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, h, 8),
    MAT.safety(),
  );
  rail.position.set(0.25, h / 2, -steps * 0.15);
  rail.rotation.z = 0.3;
  group.add(rail);
  group.position.set(x, 0, z);
  return group;
}

function makeInstrument(x, y, z) {
  const group = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.1 }),
  );
  face.rotation.x = Math.PI / 2;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8),
    MAT.steel(),
  );
  body.position.y = -0.2;
  group.add(face);
  group.add(body);
  group.position.set(x, y, z);
  return group;
}

// ─── ModelFactory ─────────────────────────────────────────────────────────────

let _coagPaddles = [];
let _animationId = null;

const ModelFactory = {
  build() {
    const scene = SceneManager.scene;
    if (!scene) throw new Error('ModelFactory: SceneManager no inicializado.');

    // ── Niebla atmosférica ────────────────────────────────────────────────────
    scene.fog = new THREE.FogExp2(0x0b0e12, 0.018);
    scene.background = new THREE.Color(0x0b0e12);

    // ── Iluminación mejorada ──────────────────────────────────────────────────
    scene.children
      .filter(c => c.isLight)
      .forEach(l => scene.remove(l));

    scene.add(new THREE.AmbientLight(0x1a2535, 1.2));

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.8);
    mainLight.position.set(8, 25, 12);
    mainLight.castShadow             = true;
    mainLight.shadow.mapSize.width   = 2048;
    mainLight.shadow.mapSize.height  = 2048;
    mainLight.shadow.camera.near     = 0.5;
    mainLight.shadow.camera.far      = 80;
    mainLight.shadow.camera.left     = -30;
    mainLight.shadow.camera.right    = 30;
    mainLight.shadow.camera.top      = 25;
    mainLight.shadow.camera.bottom   = -25;
    mainLight.shadow.bias            = -0.001;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x4060a0, 0.6);
    fillLight.position.set(-10, 10, -5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xff8844, 0.35);
    rimLight.position.set(0, 8, -20);
    scene.add(rimLight);

    const pointPositions = [[-8, 6, 8], [6, 6, 8], [14, 6, 12]];
    pointPositions.forEach(([px, py, pz]) => {
      const pt = new THREE.PointLight(0x8ab4d4, 0.8, 18, 1.5);
      pt.position.set(px, py, pz);
      scene.add(pt);
    });

    // ── Renderer con sombras ──────────────────────────────────────────────────
    if (SceneManager.renderer) {
      SceneManager.renderer.shadowMap.enabled = true;
      SceneManager.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
      SceneManager.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
      SceneManager.renderer.toneMappingExposure = 1.1;
    }

    // ── Suelo con grid ────────────────────────────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(70, 44, 35, 22);
    const ground = new THREE.Mesh(groundGeo, MAT.ground());
    ground.rotation.x    = -Math.PI / 2;
    ground.position.set(0, 0, 10);
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(70, 35, 0x1a2a1a, 0x1a2a1a);
    grid.position.set(0, 0.01, 10);
    grid.material.opacity     = 0.4;
    grid.material.transparent = true;
    scene.add(grid);

    // ── Plataforma central elevada ────────────────────────────────────────────
    const platform = shadow(new THREE.Mesh(
      new THREE.BoxGeometry(52, 0.2, 22),
      MAT.concrete(),
    ));
    platform.position.set(1, 0.1, 10);
    scene.add(platform);

    // ── Inlet — canal de entrada ──────────────────────────────────────────────
    const inletChannel = makeBox(4, 0.4, 2.5, -20, 0.2, 10, 'mesh_inlet_channel', MAT.concrete);
    scene.add(inletChannel);

    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.08, 2.3),
      MAT.steel(),
    );
    grate.position.set(-20, 0.64, 10);
    grate.castShadow = true;
    scene.add(grate);

    const inletPipe = makeCylinder(0.32, 0.32, 2.5, -18, 0, 10, 'mesh_inlet_pipe');
    scene.add(inletPipe);

    scene.add(makeValve(-18, 1.8, 10.8));
    scene.add(makeInstrument(-17.2, 2.2, 10));

    scene.add(makePipe([-18, 1.8, 10], [-9, 1.8, 10], 0.22));
    scene.add(makePipe([-9, 1.8, 10], [-9, 1.8, 14], 0.22));
    scene.add(makePipeSupport(-14, 10));
    scene.add(makePipeSupport(-11.5, 12));

    // ── Tanque de agua bruta ──────────────────────────────────────────────────
    const rawTank = makeBox(6.5, 2.5, 11, -6, 0.2, 14, 'mesh_raw_water_tank', MAT.concrete);
    scene.add(rawTank);

    const rawLid = shadow(new THREE.Mesh(
      new THREE.BoxGeometry(6.3, 0.15, 5),
      MAT.darkMetal(),
    ));
    rawLid.position.set(-6, 2.85, 11);
    scene.add(rawLid);

    scene.add(makeInstrument(-3.5, 2.4, 9.5));
    scene.add(makeInstrument(-8.3, 2.4, 9.5));

    // ── Tanques de coagulación ────────────────────────────────────────────────
    [-8, -4].forEach((x, i) => {
      const tank = makeCylinder(1.6, 1.8, 3.2, x, 0.2, 8, `mesh_coag_tank_${i + 1}`);
      scene.add(tank);

      const cone = shadow(new THREE.Mesh(
        new THREE.ConeGeometry(1.65, 0.6, 32),
        MAT.darkMetal(),
      ));
      cone.position.set(x, 3.7, 8);
      scene.add(cone);

      const paddleGeo = new THREE.BoxGeometry(0.12, 2.8, 0.9);
      const paddleMat = MAT.steel();
      const paddle    = new THREE.Mesh(paddleGeo, paddleMat);
      paddle.position.set(x, 1.8, 8);
      paddle.castShadow = true;
      scene.add(paddle);
      _coagPaddles.push(paddle);

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 3.8, 8),
        MAT.steel(),
      );
      shaft.position.set(x, 2.1, 8);
      scene.add(shaft);

      const motor = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.4, 0.5),
        MAT.darkMetal(),
      ));
      motor.position.set(x, 4.2, 8);
      scene.add(motor);

      scene.add(makeStairs(x + 1.8, 8 + 1.2, 3.2));
      scene.add(makeInstrument(x + 1.5, 2.0, 8));
      scene.add(makeValve(x - 1.6, 0.6, 8));
    });

    scene.add(makePipe([-6, 1.5, 9], [-8, 1.5, 9], 0.2));
    scene.add(makePipe([-6, 1.5, 9], [-4, 1.5, 9], 0.2));

    // ── Filtros de arena ──────────────────────────────────────────────────────
    [4, 8].forEach((x, i) => {
      const filter = makeCylinder(2.1, 2.3, 3.4, x, 0.2, 8, `mesh_filter_${i + 1}`);
      scene.add(filter);

      const dome = shadow(new THREE.Mesh(
        new THREE.SphereGeometry(2.15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3),
        MAT.darkMetal(),
      ));
      dome.position.set(x, 3.6, 8);
      scene.add(dome);

      const sight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16),
        new THREE.MeshStandardMaterial({ color: 0x88aacc, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.7 }),
      );
      sight.rotation.z = Math.PI / 2;
      sight.position.set(x + 2.2, 2.0, 8);
      scene.add(sight);

      scene.add(makeValve(x, 0.5, 8 + 2.4));
      scene.add(makeValve(x, 0.5, 8 - 2.4));
      scene.add(makeInstrument(x + 2.0, 2.8, 8.5));
      scene.add(makeInstrument(x + 2.0, 1.2, 8.5));
      scene.add(makeStairs(x + 2.3, 8 + 1.0, 3.4));
    });

    // ── Tubería de agua filtrada ──────────────────────────────────────────────
    const filteredPipeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(4,  2.0, 6),
      new THREE.Vector3(7,  2.0, 6),
      new THREE.Vector3(10, 2.0, 6),
      new THREE.Vector3(12, 2.0, 8),
    ]);
    const filteredPipeMesh = shadow(new THREE.Mesh(
      new THREE.TubeGeometry(filteredPipeCurve, 12, 0.28, 12, false),
      MAT.steel(),
    ));
    filteredPipeMesh.name = 'mesh_filtered_water_pipe';
    scene.add(filteredPipeMesh);

    [6, 9].forEach(x => scene.add(makePipeSupport(x, 6.5)));
    scene.add(makeValve(7, 2.3, 6));
    scene.add(makeInstrument(9, 2.5, 6));

    // ── Sala de cloración ─────────────────────────────────────────────────────
    const chlorRoom = makeBox(4.5, 3.5, 4.5, 16, 0.2, 10, 'mesh_chlorination_room', MAT.concrete);
    scene.add(chlorRoom);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 2.0, 0.08),
      MAT.darkMetal(),
    );
    door.position.set(16 - 2.26, 1.2, 10 - 2.3);
    scene.add(door);

    const chlorTank = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1.8, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a9e6a, roughness: 0.5, metalness: 0.3, emissive: new THREE.Color(0), emissiveIntensity: 0 }),
    ));
    chlorTank.position.set(13.5, 1.1, 10);
    scene.add(chlorTank);

    scene.add(makePipe([13.5, 1.5, 10], [14, 1.5, 8.5], 0.08));
    scene.add(makePipe([14, 1.5, 8.5], [16, 1.5, 8.5], 0.08));
    scene.add(makeValve(15, 1.8, 9));
    scene.add(makeInstrument(18.3, 2.5, 10));
    scene.add(makeInstrument(18.3, 1.5, 10));

    // ── Clearwell — depósito de almacenamiento ────────────────────────────────
    const clearwell = makeBox(8.5, 3.5, 8.5, 12, 0.2, 14, 'mesh_clearwell_tank', MAT.clearwell);
    scene.add(clearwell);

    const hatch = shadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.15, 16),
      MAT.darkMetal(),
    ));
    hatch.position.set(12, 3.87, 14);
    scene.add(hatch);

    scene.add(makeStairs(16.5, 14 + 2.0, 3.5));
    scene.add(makeInstrument(16.3, 2.0, 14));
    scene.add(makeInstrument(16.3, 1.0, 14));

    scene.add(makePipe([16, 1.5, 14], [20, 1.5, 14], 0.3));
    scene.add(makePipe([20, 1.5, 14], [20, 1.5, 12], 0.3));
    scene.add(makePipeSupport(18, 14));

    // ── Estación de bombeo ────────────────────────────────────────────────────
    const pumpStation = makeBox(3.5, 3.0, 3.5, 20, 0.2, 10, 'mesh_pump_station', MAT.concrete);
    scene.add(pumpStation);

    [9, 11].forEach(z => {
      const pump = shadow(new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.4, 0.9, 12),
        MAT.steel(),
      ));
      pump.rotation.z = Math.PI / 2;
      pump.position.set(22, 0.8, z);
      scene.add(pump);

      const pumpMotor = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.8),
        MAT.darkMetal(),
      ));
      pumpMotor.position.set(22.8, 0.8, z);
      scene.add(pumpMotor);
    });

    // ── Tubería de distribución ───────────────────────────────────────────────
    const distPipe = makeCylinder(0.42, 0.42, 7, 20, 0.2, 10, 'mesh_distribution_pipe', MAT.steel);
    scene.add(distPipe);

    scene.add(makePipe([20, 7.2, 10], [22, 7.2, 10], 0.38));
    scene.add(makePipe([20, 7.2, 10], [18, 7.2, 10], 0.38));
    scene.add(makeValve(21, 7.5, 10));
    scene.add(makeInstrument(21.5, 5.5, 10));

    // ── Barandillas perimetrales ──────────────────────────────────────────────
    this._addRailings(scene);

    // ── Columnas estructurales ────────────────────────────────────────────────
    [[-22, 5], [-22, 18], [24, 5], [24, 18]].forEach(([x, z]) => {
      const col = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 5, 0.4),
        MAT.darkMetal(),
      ));
      col.position.set(x, 2.5, z);
      scene.add(col);
    });

    // ── Iniciar animaciones ───────────────────────────────────────────────────
    this._startAnimations();
  },

  _addRailings(scene) {
    const railMat = MAT.safety();
    const postMat = MAT.darkMetal();

    const railSegments = [
      [-23, 0,  -23, 22],
      [-23, 22,  25, 22],
      [ 25, 22,  25,  0],
      [ 25,  0, -23,  0],
    ];

    railSegments.forEach(([x1, z1, x2, z2]) => {
      const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);

      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, len, 6),
        railMat,
      );
      rail.position.set((x1 + x2) / 2, 1.0, (z1 + z2) / 2);

      // Segmentos en X → rotar en Z; segmentos en Z → rotar en X
      if (x1 !== x2)      rail.rotation.z = Math.PI / 2;
      else if (z1 !== z2) rail.rotation.x = Math.PI / 2;

      scene.add(rail);

      // Postes — compensamos la altura de la plataforma (yBase = 0.2)
      const posts = Math.floor(len / 4);
      for (let i = 0; i <= posts; i++) {
        const t    = posts > 0 ? i / posts : 0;
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6),
          postMat,
        );
        post.position.set(
          x1 + t * (x2 - x1),
          0.5 + 0.2,
          z1 + t * (z2 - z1),
        );
        scene.add(post);
      }
    });
  },

  _startAnimations() {
    let t = 0;
    const animate = () => {
      _animationId = requestAnimationFrame(animate);
      t += 0.003;
      _coagPaddles.forEach((paddle, i) => {
        paddle.rotation.y = t * (i % 2 === 0 ? 1 : -1);
      });
    };
    animate();
  },

  destroy() {
    if (_animationId) {
      cancelAnimationFrame(_animationId);
      _animationId = null;
    }
    _coagPaddles = [];
  },
};

export default ModelFactory;