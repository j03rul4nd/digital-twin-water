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
| **V1.3** | Sparkplug B, KPIs, MCP server | 🔄 Pendiente |
| **V2.0** | AI Advisor (WebLLM + TinyLlama) | ⬜ Pendiente |

---

## Estructura de archivos actual

```
digital-twin-water/
├── README.md
├── index.html
├── vite.config.js                      base: '/digital-twin-water/'
├── server.js                           publicador MQTT Node.js para testing
├── .github/workflows/deploy.yml
├── docs/
│   └── mqtt-production.md
└── src/
    ├── main.js
    ├── core/
    │   ├── events.js                   EVENT_CONTRACT_VERSION = '2'
    │   ├── EventBus.js
    │   ├── SceneManager.js
    │   ├── ModelFactory.js
    │   └── AnimationLoop.js
    ├── sensors/
    │   ├── SensorConfig.js
    │   ├── SensorState.js              + getTrend()
    │   ├── SensorSceneMap.js
    │   ├── sensor.worker.js            + escenarios de incidente
    │   ├── SensorWorker.js             + scenario()
    │   ├── RuleEngine.js               + 4 reglas de tendencia
    │   └── MQTTAdapter.js              + PayloadMapper integrado
    ├── scene/
    │   ├── ColorMapper.js
    │   ├── AlertSystem.js
    │   └── SceneUpdater.js
    ├── ui/
    │   ├── TelemetryPanel.js
    │   ├── AlertPanel.js               + sección History
    │   ├── Toolbar.js
    │   ├── MiniMap.js
    │   ├── MQTTPanel.js
    │   ├── ConfigModal.js
    │   ├── SensorDetailModal.js        gráfico histórico SVG en vivo
    │   ├── IncidentPanel.js            simulación de incidentes
    │   ├── WebhookPanel.js             gestión de webhooks desde UI
    │   └── PayloadMapperPanel.js       configuración de mapeo de payloads
    └── utils/
        ├── NoiseGenerator.js
        ├── DataExporter.js
        ├── WebhookManager.js           envío de webhooks en alertas
        └── PayloadMapper.js            transformación de payloads MQTT
```

---

## Fases 1–5 — Completas

Ver historial completo en versiones anteriores de este documento.
Resumen: simulador Worker, escena 3D Three.js, RuleEngine, MQTTAdapter,
deploy GitHub Pages, server.js para HiveMQ Cloud.

---

## V1.1 — Completa ✅

### Historical charts per sensor
`SensorDetailModal.js` — clic en sensor row abre modal con gráfico SVG
en vivo de los últimos 3 minutos. Stats min/avg/max actualizados cada 500ms.

### Incident simulation mode
`IncidentPanel.js` + `sensor.worker.js` — panel flotante con 5 escenarios
(filter clog, critical, chlorine deficit, low tank, pH anomaly). 30s por
escenario con countdown, reset automático, se oculta cuando MQTT conecta.

### Trend detection in rule engine
`SensorState.getTrend(sensorId, windowSeconds)` — regresión lineal sobre
el buffer histórico. 4 reglas nuevas en `RuleEngine.js`: `filter_1_dp_rising`,
`tank_draining`, `inlet_flow_sudden_drop`, `filtered_turbidity_rising`.

---

## V1.2 — Completa ✅

### Webhooks para alertas

**`src/utils/WebhookManager.js`**
Escucha `RULE_TRIGGERED`. Cuando se activa una alerta, hace POST a las URLs
configuradas por el usuario. Soporta filtrado por evento: `alert.danger`,
`alert.warning`, `alert.resolved`.

**Fix CORS crítico:** usa `Content-Type: text/plain` en vez de `application/json`.
Esto evita el preflight OPTIONS que bloqueaba el body en webhook.site, Slack,
n8n y similares. El JSON sigue siendo válido — solo cambia el header.

Payload enviado verificado en producción:
```json
{
  "event": "alert.danger",
  "timestamp": 1774739174739,
  "plant": "plant-01",
  "alert": {
    "id": "chlorine_deficit",
    "severity": "danger",
    "sensorIds": ["inlet_flow", "chlorine_dose"],
    "message": "Chlorine dose not scaling with flow — disinfection deficit risk",
    "active": true
  }
}
```

**`src/ui/WebhookPanel.js`**
Modal accesible desde "⚡ Webhooks" en el topbar. Permite añadir/editar/
eliminar webhooks, configurar qué eventos disparan cada uno, activar/desactivar
con toggle, y hacer test antes de guardar. Dot verde/rojo indica resultado
del último envío. Config persistida en `localStorage` (clave `wtp_webhooks`).

Compatible con: webhook.site, Slack incoming webhooks, Discord, n8n, Make,
Zapier, o cualquier URL que acepte POST.

### Payload mapper

**`src/utils/PayloadMapper.js`**
Transforma cualquier formato MQTT al formato interno `{ timestamp, readings }`.

Modos:
- **Auto** — detecta automáticamente: formato nativo, Sparkplug-like arrays
  `{ metrics: [{ name, value }] }`, arrays de sensores `{ sensors: [{ id, value }] }`,
  datos bajo clave `data`, y campos planos en la raíz.
- **Flat** — todos los campos numéricos de la raíz se convierten en readings.
- **Custom** — mapeo explícito campo a campo con dot notation (`data.process.flow` → `inlet_flow`).

Integrado en `MQTTAdapter._handleMessage()` — todos los mensajes entrantes
pasan por el mapper antes de llegar a `SensorState`.

**`src/ui/PayloadMapperPanel.js`**
Modal accesible desde "⇄ Payload" en el topbar. Permite elegir el modo,
configurar el campo de timestamp, pegar un mensaje de ejemplo para analizarlo,
y definir mappings custom con selector de sensor ID. Botón "Use as custom
mappings →" pre-rellena los mappings desde el análisis automático.

Config persistida en `localStorage` (clave `wtp_payload_map`).

---

## V1.3 — Pendiente

### Sparkplug B parser
Añadir soporte nativo de Sparkplug B en el `MQTTAdapter` / `PayloadMapper`.
Sparkplug B usa Protobuf sobre MQTT con topics `spBv1.0/group/DDATA/node/device`.
Requiere una librería de decode Protobuf en el browser (protobufjs ~150KB).
Desbloquea integración directa con Ignition, Cirrus Link, y PLCs modernos.

### KPIs de proceso
Módulo `KPIEngine.js` que calcula métricas derivadas sobre `SensorState.history`:
- Litros tratados en la sesión actual
- Tiempo en estado warning/danger (% del tiempo total)
- Número de retrolavados detectados (resets de filter_1_dp)
- Eficiencia de cloración (% de ticks con cloro en rango normal)
- Consumo estimado de cloro por m³ tratado

Panel `KPIPanel.js` en la UI — números grandes, actualización cada 5s.

### MCP server para Claude Desktop
Servidor MCP en Node.js que expone tools sobre el sistema:
- `get_sensor_readings` — valores actuales de todos los sensores
- `get_active_alerts` — alertas activas con severidad y mensaje
- `get_trend` — tendencia de un sensor en una ventana de tiempo
- `get_kpis` — métricas de proceso calculadas
- `trigger_scenario` — activa un escenario de incidente
- `export_history` — devuelve el histórico de un sensor

Permite a Claude Desktop "operar" el digital twin: preguntar qué está
pasando, detectar anomalías, y activar escenarios.

---

## V2.0 — Pendiente

Rama separada `feature/ai-advisor`:
- `ai.worker.js` — TinyLlama via WebLLM (~700MB, opt-in, cached en IndexedDB)
- `AIPanel.js` — diagnóstico en lenguaje natural del proceso

---

## Archivos que NO tocar sin razón

| Archivo | Por qué |
|---|---|
| `src/core/events.js` | Si se modifica un payload, subir `EVENT_CONTRACT_VERSION` |
| `src/sensors/SensorConfig.js` | Los rangos afectan a RuleEngine, TelemetryPanel y ColorMapper |
| `src/sensors/SensorSceneMap.js` | Los nombres deben coincidir EXACTAMENTE con ModelFactory |
| `src/sensors/SensorState.js` | Singleton compartido — `getTrend()` es parte del contrato |
| `src/scene/ColorMapper.js` | `getSensorState()` usado por TelemetryPanel y SensorDetailModal |
| `src/utils/PayloadMapper.js` | Cambiarlo afecta a TODOS los mensajes MQTT entrantes |

---

## Decisiones técnicas recientes

| Decisión | Motivo |
|---|---|
| `Content-Type: text/plain` en webhooks | Evita preflight CORS que bloqueaba el body en webhook.site, Slack, n8n |
| PayloadMapper integrado en MQTTAdapter | Todos los mensajes pasan por el mismo punto de transformación |
| PayloadMapper modo auto como default | El 80% de casos funciona sin configuración adicional |
| Dot notation en custom mappings | Acceso a campos anidados sin código — `data.process.flow` funciona directamente |