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
| **V1.1** | Historical charts, incident mode, trend detection | ✅ Completa |
| **V1.2** | Webhooks, Payload mapper | ✅ Completa |
| **V1.3** | Sparkplug B, KPIs, MCP server | ✅ Completa |
| **V2.0** | AI Advisor (WebLLM + TinyLlama) | ⬜ Pendiente |

---

## Estructura de archivos actual

```
digital-twin-water/
├── README.md
├── index.html
├── vite.config.js                        base: '/digital-twin-water/'
├── server.js                             publicador MQTT Node.js para testing
├── mcp-server.js                         servidor MCP para Claude Desktop
├── mcp-bridge-server.js                  bridge browser → mcp-state.json
├── mcp-state.json                        estado del dashboard (generado en runtime)
├── .github/workflows/deploy.yml
├── docs/
│   ├── mqtt-production.md
│   └── claude-desktop-setup.md
└── src/
    ├── main.js
    ├── core/
    │   ├── events.js                     EVENT_CONTRACT_VERSION = '2'
    │   ├── EventBus.js
    │   ├── SceneManager.js
    │   ├── ModelFactory.js
    │   └── AnimationLoop.js
    ├── sensors/
    │   ├── SensorConfig.js
    │   ├── SensorState.js                + getTrend()
    │   ├── SensorSceneMap.js
    │   ├── sensor.worker.js              + escenarios de incidente
    │   ├── SensorWorker.js               + scenario()
    │   ├── RuleEngine.js                 + 4 reglas de tendencia
    │   ├── MQTTAdapter.js                + PayloadMapper + SparkplugParser
    │   └── KPIEngine.js                  métricas de proceso
    ├── scene/
    │   ├── ColorMapper.js
    │   ├── AlertSystem.js
    │   └── SceneUpdater.js
    ├── ui/
    │   ├── TelemetryPanel.js
    │   ├── AlertPanel.js                 + sección History
    │   ├── Toolbar.js
    │   ├── MiniMap.js
    │   ├── MQTTPanel.js
    │   ├── ConfigModal.js
    │   ├── SensorDetailModal.js          gráfico histórico SVG en vivo
    │   ├── IncidentPanel.js              simulación de incidentes
    │   ├── WebhookPanel.js               gestión de webhooks desde UI
    │   ├── PayloadMapperPanel.js         configuración de mapeo de payloads
    │   └── KPIPanel.js                   panel de KPIs de proceso
    └── utils/
        ├── NoiseGenerator.js
        ├── DataExporter.js
        ├── WebhookManager.js             envío de webhooks en alertas
        ├── PayloadMapper.js              transformación de payloads MQTT
        ├── SparkplugParser.js            decoder Protobuf Sparkplug B
        └── MCPBridge.js                  bridge de estado al MCP server
```

---

## Fases 1–5 — Completas

Simulador Worker con correlaciones causales, escena 3D Three.js (12 meshes
funcionales), ColorMapper + AlertSystem (capas separadas), RuleEngine con
ciclo de vida activo/resuelto, MQTTAdapter, deploy GitHub Pages, server.js
para HiveMQ Cloud.

---

## V1.1 — Completa ✅

**Historical charts** — `SensorDetailModal.js`: clic en sensor row → modal
con gráfico SVG en vivo de los últimos 3 minutos, líneas de referencia de
umbrales, stats min/avg/max actualizados cada 500ms.

**Incident simulation mode** — `IncidentPanel.js` + `sensor.worker.js`:
panel flotante con 5 escenarios (filter clog, critical, chlorine deficit,
low tank, pH anomaly). 30s por escenario con countdown, reset automático.

**Trend detection** — `SensorState.getTrend(sensorId, windowSeconds)`:
regresión lineal sobre el buffer histórico. 4 reglas nuevas en RuleEngine:
`filter_1_dp_rising`, `tank_draining`, `inlet_flow_sudden_drop`,
`filtered_turbidity_rising`.

---

## V1.2 — Completa ✅

**Webhooks** — `WebhookManager.js` + `WebhookPanel.js`:
POST a URLs configuradas desde la UI cuando se activan alertas.
Eventos: `alert.danger`, `alert.warning`, `alert.resolved`.
Fix CORS crítico: `Content-Type: text/plain` evita el preflight OPTIONS
que bloqueaba el body. Verificado en producción con webhook.site, Slack,
Discord, n8n. Config en `localStorage` (clave `wtp_webhooks`).

**Payload mapper** — `PayloadMapper.js` + `PayloadMapperPanel.js`:
Transforma cualquier formato MQTT al formato interno. Modos: auto-detect
(Sparkplug-like arrays, flat fields, nested `data`), flat, custom con
dot notation (`data.process.flow` → `inlet_flow`). Integrado en
`MQTTAdapter._handleMessage()`. Config en `localStorage` (clave `wtp_payload_map`).

---

## V1.3 — Completa ✅

### Sparkplug B parser

**`src/utils/SparkplugParser.js`**
Decoder Protobuf manual para Sparkplug B sin dependencias externas (~150 líneas).
Soporta todos los tipos numéricos (Int8–Int64, UInt8–UInt64, Float, Double, Boolean).
Detecta automáticamente por topic (`spBv1.0/.../DDATA/...`) en `MQTTAdapter`.
Compatible con Ignition, Cirrus Link, y cualquier dispositivo que hable Sparkplug B.

Integrado en `MQTTAdapter._handleMessage()`:
- Topic Sparkplug B → `SparkplugParser.parse()`
- Topic estándar → `PayloadMapper.transform()`
Sin cambio en el resto del pipeline — mismo `SensorState` → mismo `EventBus`.

### KPIs de proceso

**`src/sensors/KPIEngine.js`**
Calcula métricas derivadas sobre `SensorState.history` cada 5 segundos.
Emite `EVENTS.KPIS_UPDATED`.

KPIs calculados:
| KPI | Descripción |
|---|---|
| `throughput` | m³ tratados estimados en la ventana actual |
| `avgInletFlow` | Caudal medio en m³/h |
| `timeNormal` | % del tiempo en operación normal |
| `timeInWarning` | % del tiempo en estado warning |
| `timeInDanger` | % del tiempo en estado danger |
| `backwashCount` | Retrolavados detectados (caídas > 80 mbar en filter_1_dp) |
| `chlorinationEff` | % de ticks con cloro residual en rango normal |
| `chlorineKg` | Cloro consumido estimado en kg |
| `alertsTriggered` | Alertas activadas en la sesión |
| `sessionDuration` | Duración de la sesión en segundos |

**`src/ui/KPIPanel.js`**
Modal accesible desde "📊 KPIs" en el topbar. Muestra:
- 3 KPIs principales en grid (throughput, chlorination eff., normal operation %)
- Barra visual de distribución temporal (verde/ámbar/rojo)
- Grid secundario con backwashes, alertas, cloro consumido, samples
- Actualización cada 5s via `EVENTS.KPIS_UPDATED`

### MCP server para Claude Desktop

**`mcp-server.js`** — servidor MCP (stdio JSON-RPC) con 6 tools:

| Tool | Descripción |
|---|---|
| `get_plant_status` | Resumen completo: readings + alertas + KPIs |
| `get_sensor_readings` | Valores actuales, filtrable por sensor ID |
| `get_active_alerts` | Alertas activas filtrable por severidad |
| `get_kpis` | KPIs de proceso formateados para lectura |
| `get_sensor_trend` | Análisis de tendencia con regresión lineal |
| `get_alert_history` | Últimas alertas resueltas con duración |

**`mcp-bridge-server.js`** — servidor Express en puerto 3001.
Recibe el estado del dashboard via POST y lo escribe en `mcp-state.json`.
CORS abierto solo para `localhost:5173`.

**`src/utils/MCPBridge.js`** — módulo del dashboard.
Envía el estado actual (readings, alertas, KPIs, historial) al bridge
cada 1 segundo via fetch.

Flujo completo:
```
Dashboard → MCPBridge → POST localhost:3001/state
                      → mcp-bridge-server escribe mcp-state.json
                      → mcp-server.js lee mcp-state.json
                      → Claude Desktop llama tools via MCP protocol
```

Configuración en `docs/claude-desktop-setup.md`.

Prompts de ejemplo que funcionan:
- "¿Hay alertas activas en la planta?"
- "¿Cuál es la tendencia del filtro 1 en los últimos 2 minutos?"
- "Dame un resumen del estado de la planta y los KPIs"
- "¿Ha habido retrolavados en esta sesión?"

---

## V2.0 — Pendiente

Rama separada `feature/ai-advisor`:
- `ai.worker.js` — TinyLlama via WebLLM (~700MB, opt-in, cached en IndexedDB)
- `AIPanel.js` — diagnóstico en lenguaje natural del proceso

No mezclar con `main` hasta tener tracción suficiente en el repo.

---

## Events catalog actual (`src/core/events.js`)

```
EVENT_CONTRACT_VERSION = '2'

SENSOR_UPDATE      — snapshot completo cada 500ms
RULE_TRIGGERED     — alerta activa/resuelta (active: true/false)
MQTT_CONNECTING    — usuario solicitó conexión
MQTT_CONNECTED     — broker confirmó sesión
MQTT_ERROR         — fallo de conexión
MQTT_DISCONNECTED  — sesión terminada
EXPORT_STARTED     — usuario pulsó Export CSV
EXPORT_COMPLETE    — export completado
SCENARIO_CHANGED   — escenario de incidente activado/cancelado
WEBHOOK_RESULT     — resultado de envío de webhook
KPIS_UPDATED       — KPIs recalculados (cada 5s)
```

---

## Archivos que NO tocar sin razón

| Archivo | Por qué |
|---|---|
| `src/core/events.js` | Si se modifica un payload, subir `EVENT_CONTRACT_VERSION` |
| `src/sensors/SensorConfig.js` | Los rangos afectan a RuleEngine, TelemetryPanel, ColorMapper y KPIEngine |
| `src/sensors/SensorSceneMap.js` | Los nombres deben coincidir EXACTAMENTE con ModelFactory |
| `src/sensors/SensorState.js` | Singleton compartido — `getTrend()` y `history` son parte del contrato |
| `src/scene/ColorMapper.js` | `getSensorState()` usado por TelemetryPanel, SensorDetailModal y KPIEngine |
| `src/utils/PayloadMapper.js` | Cambiarlo afecta a TODOS los mensajes MQTT entrantes |
| `src/utils/SparkplugParser.js` | El decode Protobuf es frágil — no tocar sin conocer el wire format |