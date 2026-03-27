# PROGRESS.md — Estado de implementación

> Leer junto a `PRODUCT.md` y `DESIGN.md`.
> Actualizar al cerrar cada fase o al hacer cambios significativos.

---

## Estado general

| Fase | Nombre | Estado |
|---|---|---|
| **Fase 1** | Contratos y data first | ✅ Completa |
| **Fase 2** | Escena que reacciona a datos | ✅ Completa |
| **Fase 3** | UI | ✅ Completa |
| **Fase 4** | Adapter + RuleEngine + polish | ✅ Completa |
| **Fase 5** | Launch | ✅ Completa |
| **Post-launch** | Mejoras iterativas | ✅ En curso |
| **Fase 6** | V2.0 (post-tracción) | ⬜ Pendiente |

---

## Fase 1 — Completa

```
src/core/events.js         Catálogo EVENTS + EVENT_CONTRACT_VERSION
src/core/EventBus.js       Pub/sub desacoplado
src/sensors/SensorConfig.js  10 sensores WTP + validador dev mode
src/sensors/SensorState.js   Singleton + buffer 360 snapshots + isReady() + reset()
src/sensors/SensorSceneMap.js  Binding sensor → mesh 3D + getMeshNames()
src/sensors/sensor.worker.js   Simulador con correlaciones causales
src/utils/NoiseGenerator.js    Ruido suavizado por sensorId
vite.config.js             worker: { format: 'es' } + base: '/digital-twin-water/'
```

---

## Fase 2 — Completa

```
src/core/SceneManager.js   Renderer WebGL2 + cámara + luces + OrbitControls
src/core/ModelFactory.js   Planta WTP procedural, 12 meshes con MeshStandardMaterial
src/core/AnimationLoop.js  RAF loop con OrbitControls.update()
src/scene/ColorMapper.js   valor → material.color (nunca emissive)
src/scene/AlertSystem.js   RULE_TRIGGERED → emissiveIntensity 0.35 (nunca color)
src/scene/SceneUpdater.js  Coordina ColorMapper y AlertSystem via SensorSceneMap
```

---

## Fase 3 — Completa

```
index.html               Layout completo + tokens CSS DESIGN.md + fuentes
src/ui/TelemetryPanel.js  10 rows, actualización DOM quirúrgica, badge live
src/ui/AlertPanel.js      Alertas con acento, timestamps relativos, fade out
src/ui/Toolbar.js         Topbar: dot MQTT, alert chip opacity 0/1
src/ui/MiniMap.js         Leaflet + tiles dark + circleMarker Reus
```

---

## Fase 4 — Completa

```
src/main.js              init() 6 pasos, orquestación Worker↔MQTT, error screen
src/sensors/RuleEngine.js  11 reglas RULES[], getActiveAlerts(), clearAlerts()
src/sensors/MQTTAdapter.js  Conexión broker real, fix CJS/ESM Vite, sin credenciales hardcodeadas
src/sensors/SensorWorker.js  Wrapper Worker con start/pause/resume/stop
src/ui/MQTTPanel.js       Lee config de localStorage via ConfigModal.loadConfig()
src/utils/DataExporter.js   CSV + JSON desde SensorState.history
```

---

## Fase 5 — Completa

```
README.md                Marketing-first, Quick Start 3 comandos, ganchos técnicos
docs/mqtt-production.md  Snippet Python + bridge Node.js para instalaciones reales
.github/workflows/deploy.yml  GitHub Actions → GitHub Pages automático
```

---

## Post-launch — Mejoras iterativas

### ConfigModal — Panel de configuración MQTT en UI

**Problema resuelto:** Las credenciales del broker estaban hardcodeadas en `MQTTPanel.js`. Cualquier usuario que forkeara el repo tenía las credenciales expuestas, y cambiar el broker requería editar código.

**Solución implementada:**

**`src/ui/ConfigModal.js`** — Modal de configuración accesible desde el botón `⚙ Settings` del topbar.
- Campos: Broker URL, Username, Password, Plant ID
- Validación inline antes de intentar conectar (URL vacía, formato incorrecto)
- Botón "Test & Connect →" que intenta la conexión real y muestra el resultado en el modal
- Si conecta: guarda en `localStorage` y cierra el modal automáticamente tras 1.2s
- Si falla: muestra el error sin cerrar — el usuario puede corregir y reintentar
- Cierre con `Escape`, clic fuera del modal, o botón Cancel
- Al recargar la página, los valores del `localStorage` se pre-rellenan automáticamente

**Claves de `localStorage`:**
```
wtp_broker_url   — URL completa wss://...
wtp_username     — usuario del broker
wtp_password     — contraseña
wtp_plant_id     — plant ID
```

**Archivos modificados:**

`src/ui/MQTTPanel.js` — ya no tiene credenciales hardcodeadas. Lee de `loadConfig()` de `ConfigModal` en el momento de conectar. Si no hay config guardada, el clic en "Connect" abre el modal directamente.

`src/sensors/MQTTAdapter.js` — eliminada la URL de broker por defecto. Recibe toda la config de `options{}`. Fix del import dinámico de `mqtt` para Vite (`mod.default ?? mod`).

`src/main.js` — añadido `ConfigModal.init()` en el paso 4 de `init()`.

`index.html` — añadido botón `⚙ Settings` en el topbar + CSS completo del modal (overlay, inputs, footer, estados de status).

### Fix MQTT — import dinámico con Vite

**Problema:** `mqtt.connect is not a function`. Vite bundlea `mqtt` (CJS) como `{ default: { connect, ... } }` en vez de `{ connect, ... }`.

**Fix:** `const mod = await import('mqtt'); mqttLib = mod.default ?? mod;`

---

## Fase 6 — Pendiente (V2.0)

```
feature/ai-advisor branch
  ai.worker.js       TinyLlama via WebLLM (~700MB, opt-in)
  AIPanel.js         Diagnóstico en lenguaje natural del proceso
```

### Para Fase 6 recordar:
- Rama separada `feature/ai-advisor` — no en main
- El simulador y el RuleEngine siguen funcionando sin la IA
- `postMessage` copia datos entre threads — overhead de serialización a medir
- IndexedDB para cachear el modelo tras la primera descarga

---

## Archivos que NO tocar sin razón

Estos archivos son contratos de arquitectura. Cambiarlos tiene efectos en cascada:

- `src/core/events.js` — si se modifica un payload, subir `EVENT_CONTRACT_VERSION`
- `src/sensors/SensorConfig.js` — los rangos afectan a RuleEngine, TelemetryPanel y ColorMapper
- `src/sensors/SensorSceneMap.js` — los nombres deben coincidir EXACTAMENTE con ModelFactory
- `src/sensors/SensorState.js` — singleton compartido por todos los módulos