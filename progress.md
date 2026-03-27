# PROGRESS.md — Estado de implementación

> Leer junto a `PRODUCT.md` y `DESIGN.md`.
> Este documento describe qué está implementado, qué decisiones se tomaron al hacerlo,
> y qué viene a continuación. Actualizar al cerrar cada fase.

---

## Estado general

| Fase | Nombre | Estado |
|---|---|---|
| **Fase 1** | Contratos y data first | ✅ Completa |
| **Fase 2** | Escena que reacciona a datos | ✅ Completa |
| **Fase 3** | UI | ✅ Completa |
| **Fase 4** | Adapter + RuleEngine + polish | ✅ Completa |
| **Fase 5** | Launch | ⬜ Pendiente |
| **Fase 6** | V2.0 (post-tracción) | ⬜ Pendiente |

---

## Fase 1 — Completa

### Archivos creados

```
src/
├── core/
│   ├── events.js
│   └── EventBus.js
├── sensors/
│   ├── SensorConfig.js
│   ├── SensorState.js
│   ├── SensorSceneMap.js
│   └── sensor.worker.js
└── utils/
    └── NoiseGenerator.js

vite.config.js
```

### Lo que hace cada archivo

**`src/core/events.js`**
Catálogo centralizado de todos los nombres de evento del sistema y sus payloads documentados. Exporta `EVENTS` y `EVENT_CONTRACT_VERSION = '1'`. Ningún módulo usa strings literales de eventos — siempre importa de aquí. Es el primer archivo que existe porque todos los demás lo importan.

**`src/core/EventBus.js`**
Pub/sub desacoplado. Expone `on()`, `off()`, `emit()` y `clear()`. Solo para notificaciones — el estado vive en `SensorState`. Incluye try/catch por handler para que un error en un listener no rompa la cadena. Todos los módulos que llamen a `.on()` deben llamar a `.off()` en su `destroy()`.

**`src/sensors/SensorConfig.js`**
Definición de los 10 sensores WTP con rangos `normal`, `warning` y `danger`, unidades, y rango de visualización (`rangeMin`/`rangeMax`) para la barra de progreso de la UI. Orden de flujo del proceso, no alfabético. Incluye validador que lanza errores descriptivos en dev mode si un fork añade un sensor con campos faltantes o rangos inválidos. Cero overhead en producción.

**`src/sensors/SensorState.js`**
Singleton. Única fuente de verdad del estado actual. Mantiene `readings`, `history` (buffer circular de 360 snapshots ≈ 3 minutos), y `lastTimestamp`. Expone `isReady()`, `getHistory()` y `reset()`.

**`src/sensors/SensorSceneMap.js`**
Binding entre IDs de sensor y nombres de mesh 3D. Expone el mapa directo y la función helper `getMeshNames(sensorId)` con el warn de dev para IDs desconocidos.

**`src/sensors/sensor.worker.js`**
Simulador en Web Worker. Genera un snapshot completo de los 10 sensores cada 500ms con correlaciones causales. Acepta comandos `{ cmd: 'pause' }` y `{ cmd: 'resume' }`.

**`src/utils/NoiseGenerator.js`**
Generador de ruido suavizado con fase independiente por `sensorId`. API: `noise(sensorId, amplitude, speed?)` y `resetNoise()`.

**`vite.config.js`**
Configuración de Vite. Línea crítica: `worker: { format: 'es' }`.

---

## Fase 2 — Completa

### Archivos creados

```
src/
├── core/
│   ├── SceneManager.js
│   ├── ModelFactory.js
│   └── AnimationLoop.js
└── scene/
    ├── ColorMapper.js
    ├── AlertSystem.js
    └── SceneUpdater.js
```

### Lo que hace cada archivo

**`src/core/SceneManager.js`**
Setup Three.js: renderer WebGL2 con `alpha: true`, cámara `position(0,22,30)` + `lookAt(0,0,10)`, `AmbientLight(0.4)` + `DirectionalLight(0.8)` desde `(10,20,10)`, `OrbitControls` con damping. Incluye resize handler.

**`src/core/ModelFactory.js`**
Planta WTP procedural con 12 meshes funcionales nombrados exactamente como `SensorSceneMap.js`. Todos usan `MeshStandardMaterial` — requisito de `AlertSystem`. Color neutro `#666` hasta el primer tick. Posiciones y dimensiones según la Decisión 17 de PRODUCT.md.

**`src/core/AnimationLoop.js`**
RAF loop. Actualiza `OrbitControls` y llama a `renderer.render()`. Expone `start()` y `stop()`.

**`src/scene/ColorMapper.js`**
Mapea valor → `material.color`. Colores: `#22c55e` normal, `#f59e0b` warning, `#ef4444` danger. Nunca toca `emissive`. Exporta `getSensorState()` y `getColorForState()` como helpers para `TelemetryPanel`.

**`src/scene/AlertSystem.js`**
Escucha `RULE_TRIGGERED`. Aplica `emissiveIntensity: 0.35` al activarse, `0` al resolverse. Nunca toca `material.color`.

**`src/scene/SceneUpdater.js`**
Escucha `SENSOR_UPDATE`. Itera sensores del snapshot, obtiene meshes via `getMeshNames()` y llama a `ColorMapper.apply()`. No actúa hasta `SensorState.isReady()`.

---

## Fase 3 — Completa

### Archivos creados

```
src/
└── ui/
    ├── TelemetryPanel.js
    ├── AlertPanel.js
    ├── Toolbar.js
    └── MiniMap.js

index.html
```

### Lo que hace cada archivo

**`index.html`**
Estructura DOM completa con todos los tokens CSS de DESIGN.md, layout de paneles flotantes sobre el viewport 3D, fuentes JetBrains Mono + IBM Plex Sans, CSS global (scrollbar, `.live-dot`, `.alert-item`, `.map-tiles-dark`).

**`src/ui/TelemetryPanel.js`**
10 sensor rows en orden de flujo del proceso. Actualiza solo los atributos que cambian via `element.style.setProperty()`. Muestra `—` hasta `isReady()`. Activa el badge `live` en el primer tick. Reutiliza `getSensorState()` de `ColorMapper`.

**`src/ui/AlertPanel.js`**
Lista de alertas activas. Alert items con acento izquierdo 3px, sensor IDs en mono, mensaje, timestamp relativo. Orden: danger primero. Resolución con fade. Timer de 30s para timestamps. Estado vacío `No active alerts`.

**`src/ui/Toolbar.js`**
Topbar 40px. Dot de fuente + texto de estado MQTT. Alert chip con `opacity: 0/1`. Sincronización Plant ID. Botones `Export CSV` y `Docs ↗`.

**`src/ui/MiniMap.js`**
Mapa Leaflet 120px. Tiles OSM con `.map-tiles-dark`. Marcador `circleMarker` en `[41.1189, 1.2445]`. Sin interacción. `invalidateSize()` con delay de 100ms.

---

## Fase 4 — Completa

### Archivos creados

```
src/
├── main.js
├── sensors/
│   ├── RuleEngine.js
│   ├── MQTTAdapter.js
│   └── SensorWorker.js
├── ui/
│   └── MQTTPanel.js
└── utils/
    └── DataExporter.js
```

### Lo que hace cada archivo

**`src/main.js`**
Entry point. `init()` asíncrono con orden explícito en 6 pasos según Decisión 11. Orquesta la transición Worker ↔ MQTT: `MQTT_CONNECTED` → `SensorState.reset()` + `RuleEngine.clearAlerts()` + `SensorWorker.pause()`; `MQTT_ERROR/DISCONNECTED` → `reset()` + `clearAlerts()` + `SensorWorker.resume()`. Error screen visible en `init().catch()`.

**`src/sensors/RuleEngine.js`**
11 reglas en array `RULES[]` con `condition(readings)`. Gestiona `activeAlerts` internamente. Emite `RULE_TRIGGERED` con `active: true/false`. Expone `getActiveAlerts()` y `clearAlerts()`. Las reglas cubren: filtros colmatados (warning y danger), déficit de desinfección, cloro residual bajo, turbidez post-filtración alta, nivel de clearwell bajo y crítico, pH de coagulación fuera de rango, presión de distribución baja, caudal anómalo.

**`src/sensors/MQTTAdapter.js`**
Conexión a broker MQTT real via WebSocket. Carga `mqtt` dinámicamente. Topic: `wtp/plant/{plantId}/sensors`. Parsing defensivo — nunca propaga errores al sistema. Emite los 4 eventos del ciclo de vida. `disconnect()` retorna una Promise. Documentado con el límite de TLS mutuo.

**`src/sensors/SensorWorker.js`**
Wrapper del Web Worker. Instancia `sensor.worker.js` con `{ type: 'module' }`. Expone `start()`, `pause()`, `resume()`, `stop()`. Recibe mensajes del Worker y emite `SENSOR_UPDATE` via `EventBus`.

**`src/ui/MQTTPanel.js`**
Lógica del botón Connect/Disconnect. Estados: idle → connecting (disabled) → connected (rojo) → error (retry + mensaje). Actualiza el indicador de fuente en el panel. Módulo separado de `Toolbar` porque gestiona estado propio.

**`src/utils/DataExporter.js`**
Escucha `EXPORT_STARTED`. Exporta CSV (columnas: timestamp + 10 sensores) y JSON (array de snapshots con metadata). Maneja history vacío con comentario explícito. Descarga via `URL.createObjectURL`.

### Dependencias adicionales necesarias

```bash
npm install mqtt
```

---

## Fase 5 — Pendiente

### Archivos a crear

```
README.md                      ← marketing + Quick Start + ganchos técnicos
docs/
└── mqtt-production.md         ← snippet Python para instalaciones reales
.github/
└── workflows/
    └── deploy.yml             ← GitHub Actions para deploy automático a GitHub Pages
```

### Qué debe pasar en esta fase

**`README.md`**
El README es marketing, no documentación. El orden importa (PRODUCT.md §Estructura del README):
- GIF de 3 segundos del dashboard funcionando — **antes del título**
- `## Live Demo` — primera sección, link a Vercel/GitHub Pages
- `## What is this` — 3 líneas máximo
- `## Quick Start` — 3 comandos (`git clone`, `npm install`, `npm run dev`)
- `## Connect your real MQTT broker` — gancho técnico clave con snippet mínimo y nota honesta sobre TLS mutuo
- `## Adding your own sensors` — ejemplo mínimo de regla nueva en `RULES[]`
- `## Architecture` — diagrama del flujo EventBus + SensorState (texto o ASCII)
- `## Roadmap` — AI Advisor como V2.0
- `## Built by` — nombre + portfolio/LinkedIn

**`docs/mqtt-production.md`**
Snippet Python completo para publicar desde una instalación real. Referenciado desde el README en la sección "Connect your real MQTT broker".

**`.github/workflows/deploy.yml`**
GitHub Actions: en push a `main`, ejecuta `npm ci` + `npm run build` y despliega `dist/` a GitHub Pages. Requiere activar GitHub Pages en los settings del repo (source: GitHub Actions).

### Recordatorios críticos para esta fase

- Si el repo se va a GitHub Pages con nombre de repo distinto de la raíz, cambiar `base: '/'` a `base: '/nombre-del-repo/'` en `vite.config.js` antes de hacer el build.
- El GIF del README debe capturar el estado "2 alertas activas" con Filter 1 en rojo — es el estado más visual y comunica el valor del RuleEngine de un vistazo (DESIGN.md §Relación con las fases).
- El `npm run dev` debe funcionar en menos de 10 segundos. Sin 700MB de WebLLM, esto es trivialmente alcanzable.
- Los dos ganchos técnicos del README ("Connect real MQTT" y "Adding your own sensors") son los que generan forks y stars — no escatimar en claridad en esas dos secciones.