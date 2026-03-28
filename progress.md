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
| **V1.1** | Historical charts, incident mode, trend detection | 🔄 Parcial |
| **Fase 6 / V2.0** | AI Advisor (WebLLM + TinyLlama) | ⬜ Pendiente |

---

## Estructura de archivos actual

```
digital-twin-water/
├── README.md
├── index.html
├── vite.config.js                      base: '/digital-twin-water/'
├── server.js                           publicador MQTT Node.js para testing
├── .github/workflows/deploy.yml        GitHub Actions → GitHub Pages
├── docs/
│   └── mqtt-production.md
└── src/
    ├── main.js
    ├── core/
    │   ├── events.js
    │   ├── EventBus.js
    │   ├── SceneManager.js
    │   ├── ModelFactory.js
    │   └── AnimationLoop.js
    ├── sensors/
    │   ├── SensorConfig.js
    │   ├── SensorState.js
    │   ├── SensorSceneMap.js
    │   ├── sensor.worker.js
    │   ├── SensorWorker.js
    │   ├── RuleEngine.js
    │   └── MQTTAdapter.js
    ├── scene/
    │   ├── ColorMapper.js
    │   ├── AlertSystem.js
    │   └── SceneUpdater.js
    ├── ui/
    │   ├── TelemetryPanel.js
    │   ├── AlertPanel.js
    │   ├── Toolbar.js
    │   ├── MiniMap.js
    │   ├── MQTTPanel.js
    │   ├── ConfigModal.js
    │   └── SensorDetailModal.js
    └── utils/
        ├── NoiseGenerator.js
        └── DataExporter.js
```

---

## Fases 1–5 — Completas

Ver historial de decisiones de arquitectura en `PRODUCT.md`.

Resumen de lo construido:

- Simulador en Web Worker con correlaciones causales entre sensores
- Escena 3D procedural (Three.js) con 12 meshes funcionales vinculados a sensores
- ColorMapper (material.color) + AlertSystem (emissiveIntensity) — capas separadas sin conflicto
- RuleEngine con 11 reglas y ciclo de vida de alertas (active/resolved)
- MQTTAdapter enchufable a broker real — fix Vite CJS/ESM aplicado
- Panel de telemetría con 10 sensor rows actualizados quirúrgicamente
- Panel de alertas con sección Active + History
- ConfigModal para configurar broker desde UI sin tocar código
- SensorDetailModal con gráfico SVG histórico en vivo
- Deploy automático a GitHub Pages via GitHub Actions
- `server.js` para publicar datos reales a HiveMQ Cloud

---

## Post-launch — Mejoras implementadas

### 1. ConfigModal — Configuración MQTT desde UI

**Archivo:** `src/ui/ConfigModal.js`

Modal de punto único de control para todo lo relacionado con MQTT. Accesible desde el botón "Configure & Connect →" del panel MQTT.

Estados del modal: idle → connecting → connected → error. Cuando está conectado muestra un panel verde con broker, plant ID y topic activos, y el botón cambia a "Disconnect". El error se muestra dentro del modal sin cerrarlo — el usuario puede corregir y reintentar.

Config guardada en `localStorage` (claves: `wtp_broker_url`, `wtp_username`, `wtp_password`, `wtp_plant_id`). Se pre-rellena automáticamente al reabrir.

**Archivos relacionados modificados:**
- `src/ui/MQTTPanel.js` — ahora es solo un indicador de estado. El botón abre `ConfigModal` directamente.
- `src/sensors/MQTTAdapter.js` — sin URL hardcodeada, recibe todo de `options{}`.
- `src/main.js` — `ConfigModal.init()` en paso 4.
- `index.html` — botón del panel renombrado a "Configure & Connect →", CSS del modal, ⚙ Settings eliminado del topbar.

### 2. AlertPanel — Historial de alertas resueltas

**Archivo:** `src/ui/AlertPanel.js`

Dos secciones en el panel:
- **Active** — alertas activas en tiempo real (igual que antes)
- **History** — alertas que se resolvieron, con duración ("active 45s") y timestamp de resolución

Las alertas resueltas NO desaparecen — hacen fade suave y pasan a History. El usuario puede ver qué pasó, cuándo y cuánto duró. Guarda las últimas 20 en memoria. Botón "Clear" para limpiar el historial. El counter del header cambia: `2 active` en rojo / `5 in history` en gris / `—` cuando no hay nada.

Importa `RuleEngine` directamente para recuperar alertas activas existentes en `init()`.

### 3. SensorDetailModal — Histórico gráfico por sensor ✅ V1.1

**Archivo:** `src/ui/SensorDetailModal.js`

Modal que se abre al hacer clic en cualquier sensor row. Muestra:
- Valor actual grande con color semántico
- Badge de estado (Normal / Warning / Danger)
- Gráfico SVG de los últimos 3 minutos (360 snapshots × 500ms) con líneas de referencia para umbrales warning y danger
- Stats en tiempo real: min, avg, max, número de muestras
- Se actualiza cada 500ms mientras está abierto

SVG puro, sin librerías externas. Hover sobre el row muestra un icono `↗` como señal de que es clicable.

**Archivos relacionados modificados:**
- `src/ui/TelemetryPanel.js` — importa `SensorDetailModal`, rows tienen click handler.
- `src/main.js` — `SensorDetailModal.init()` en paso 4.
- `index.html` — CSS del modal de detalle + icono hover en rows.

---

## V1.1 — Estado parcial

| Feature | Estado |
|---|---|
| Historical charts per sensor | ✅ Implementado (SensorDetailModal) |
| Incident simulation mode | ⬜ Pendiente |
| Trend detection in rule engine | ⬜ Pendiente |

### Incident simulation mode — pendiente

Modo que activa escenarios de fallo desde la UI sin necesitar el `server.js`. El usuario pulsa un botón en el dashboard y el simulador fuerza una situación anómala para ver cómo reacciona el sistema.

Escenarios previstos:
- `filter_clog` — Filter #1 DP sube a 180 mbar (warning)
- `filter_critical` — Filter #1 DP sube a 205 mbar (danger)
- `chlorine_deficit` — dosis de cloro no escala con caudal
- `low_tank` — nivel de clearwell cae por debajo del umbral
- `reset` — vuelve a valores normales

Implementación: un panel o modal con botones que envían comandos al `sensor.worker.js` via `SensorWorker`. El Worker necesita un modo `{ cmd: 'scenario', name: '...' }` que sobreescriba los valores del simulador durante N segundos.

### Trend detection in rule engine — pendiente

El RuleEngine actualmente evalúa solo el valor puntual de cada tick. Con `SensorState.getHistory()` puede detectar tendencias sobre una ventana temporal.

Reglas de tendencia previstas:
- `filter_1_dp_rising` — filter_1_dp ha subido más de X mbar en los últimos Y segundos
- `tank_draining` — tank_level lleva N ticks bajando consecutivamente sin recuperación
- `inlet_flow_drop` — inlet_flow ha caído más de un 30% respecto a la media de los últimos 2 minutos

Implementación: añadir una función helper `getTrend(sensorId, windowSeconds)` en `SensorState` que devuelva `{ slope, delta, direction }`. Las reglas de tendencia la consumen en su `condition()`.

---

## V2.0 — Pendiente

Rama separada `feature/ai-advisor`:
- `ai.worker.js` — TinyLlama via WebLLM (~700MB, opt-in, cached en IndexedDB)
- `AIPanel.js` — diagnóstico en lenguaje natural del proceso

No mezclar con `main` hasta tener tracción suficiente en el repo.

---

## Archivos que NO tocar sin razón

| Archivo | Por qué |
|---|---|
| `src/core/events.js` | Si se modifica un payload, subir `EVENT_CONTRACT_VERSION` |
| `src/sensors/SensorConfig.js` | Los rangos afectan a RuleEngine, TelemetryPanel y ColorMapper |
| `src/sensors/SensorSceneMap.js` | Los nombres deben coincidir EXACTAMENTE con ModelFactory |
| `src/sensors/SensorState.js` | Singleton compartido por todos los módulos |
| `src/scene/ColorMapper.js` | `getSensorState()` es usado por TelemetryPanel y SensorDetailModal |

---

## Decisiones técnicas recientes

| Decisión | Motivo |
|---|---|
| ConfigModal como punto único de control MQTT | Evitar confusión entre botón del panel y ⚙ del topbar |
| Alertas resueltas → History en vez de desaparecer | El usuario necesita saber qué pasó y cuánto duró |
| SVG puro para el gráfico histórico | Sin dependencias, sin peso, renderiza en cualquier browser |
| Click en sensor row para abrir detalle | UX natural — el dato lleva al contexto, no al revés |
| MQTTAdapter sin URL hardcodeada | Las credenciales nunca deben estar en el código |
| Fix `mod.default ?? mod` en MQTTAdapter | Vite bundlea mqtt como CJS wrapped — normaliza ambos casos |