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
| **V2.0** | AI Advisor (WebLLM + TinyLlama) | ⬜ Pendiente |

---

## Estructura de archivos actual

```
digital-twin-water/
├── README.md
├── index.html
├── vite.config.js
├── server.js
├── .github/workflows/deploy.yml
├── docs/
│   └── mqtt-production.md
└── src/
    ├── main.js
    ├── core/
    │   ├── events.js             EVENT_CONTRACT_VERSION = '2'
    │   ├── EventBus.js
    │   ├── SceneManager.js
    │   ├── ModelFactory.js
    │   └── AnimationLoop.js
    ├── sensors/
    │   ├── SensorConfig.js
    │   ├── SensorState.js        + getTrend()
    │   ├── SensorSceneMap.js
    │   ├── sensor.worker.js      + escenarios de incidente
    │   ├── SensorWorker.js       + scenario()
    │   ├── RuleEngine.js         + 4 reglas de tendencia
    │   └── MQTTAdapter.js
    ├── scene/
    │   ├── ColorMapper.js
    │   ├── AlertSystem.js
    │   └── SceneUpdater.js
    ├── ui/
    │   ├── TelemetryPanel.js     + click → SensorDetailModal
    │   ├── AlertPanel.js         + sección History
    │   ├── Toolbar.js
    │   ├── MiniMap.js
    │   ├── MQTTPanel.js          solo indicador de estado
    │   ├── ConfigModal.js        configuración MQTT desde UI
    │   ├── SensorDetailModal.js  gráfico histórico SVG en vivo
    │   └── IncidentPanel.js      simulación de incidentes
    └── utils/
        ├── NoiseGenerator.js
        └── DataExporter.js
```

---

## Fases 1–5 — Completas

- Simulador en Web Worker con correlaciones causales
- Escena 3D procedural Three.js, 12 meshes funcionales
- ColorMapper + AlertSystem — capas separadas sin conflicto
- RuleEngine con ciclo de vida activo/resuelto
- MQTTAdapter con fix Vite CJS/ESM
- Deploy automático a GitHub Pages
- `server.js` para publicar datos reales a HiveMQ Cloud

---

## V1.1 — Completa ✅

### Historical charts per sensor

**`src/ui/SensorDetailModal.js`** — clic en sensor row abre modal con:
- Valor actual con color semántico + badge Normal/Warning/Danger
- Gráfico SVG de los últimos 3 minutos con líneas de referencia de umbrales
- Stats: min, avg, max, samples — actualizados cada 500ms en vivo
- Icono `↗` aparece en hover sobre el row como señal de que es clicable

### Incident simulation mode

**`src/ui/IncidentPanel.js`** — panel flotante centrado en la parte inferior de la escena.

Pill colapsada por defecto. Al expandir muestra 5 escenarios en grid 2×2:
- **Filter #1 Clog** — DP sube a 185 mbar (warning)
- **Filter #1 Critical** — DP sube a 215 mbar (danger)
- **Chlorine Deficit** — dosis no escala con caudal alto (danger)
- **Low Tank Level** — nivel baja a ~18% (warning)
- **pH Anomaly** — pH cae a 5.8 (warning)

Cada escenario dura 30 segundos con countdown visible. Botón "Reset to normal" cancela inmediatamente. El panel se oculta cuando MQTT está conectado.

**`src/sensors/sensor.worker.js`** — nuevo comando `{ cmd: 'scenario', name, durationMs }`. Los escenarios sobreescriben los valores del simulador durante la duración indicada y luego vuelven a normal automáticamente. El Worker emite `{ type: 'scenario_update' }` para notificar cambios de estado.

**`src/sensors/SensorWorker.js`** — método `scenario(name, durationMs)` + manejo de mensajes `scenario_update` que emite `EVENTS.SCENARIO_CHANGED`.

**`src/core/events.js`** — añadido `EVENTS.SCENARIO_CHANGED`. `EVENT_CONTRACT_VERSION` subido a `'2'`.

### Trend detection in rule engine

**`src/sensors/SensorState.js`** — nuevo método `getTrend(sensorId, windowSeconds, stableThreshold?)`.

Usa **regresión lineal** (mínimos cuadrados) sobre la ventana temporal indicada. Más robusto que comparar primer/último valor — no se deja engañar por picos puntuales.

Devuelve: `{ slope, delta, deltaRel, direction, samples, mean, first, last }` o `null` si no hay suficientes datos.

**`src/sensors/RuleEngine.js`** — 4 reglas de tendencia nuevas. La función `evaluate()` pasa `SensorState` como segundo argumento a `condition(readings, state)` — las reglas simples ignoran el segundo argumento, las de tendencia lo usan para llamar a `state.getTrend()`.

| Regla | Ventana | Condición | Propósito |
|---|---|---|---|
| `filter_1_dp_rising` | 60s | slope > 0.8 mbar/s, rising | Predice colmatación antes del umbral |
| `tank_draining` | 90s | falling, deltaRel < -15% | Detecta vaciado progresivo |
| `inlet_flow_sudden_drop` | 30s | falling, deltaRel < -35% | Detecta fallo en bomba de entrada |
| `filtered_turbidity_rising` | 120s | rising, deltaRel > 50% | Detecta degradación del medio filtrante |

Todas las reglas de tendencia incluyen una guardia que las desactiva si el valor ya tiene alerta absoluta activa — evita doble alerta por el mismo problema.

---

## Post-launch — Mejoras de UX implementadas

### ConfigModal

Punto único de control para MQTT. Modal accesible desde "Configure & Connect →" en el panel MQTT. Detecta si ya hay conexión activa al abrirse y muestra el estado correcto. Config guardada en `localStorage`.

### AlertPanel con History

Las alertas resueltas no desaparecen — pasan a sección History con duración ("active 45s") y timestamp de resolución. Últimas 20 en memoria. Botón Clear.

---

## V2.0 — Pendiente

Rama separada `feature/ai-advisor`:
- `ai.worker.js` — TinyLlama via WebLLM (~700MB, opt-in, cached en IndexedDB)
- `AIPanel.js` — diagnóstico en lenguaje natural del proceso

No mezclar con `main` hasta tener tracción suficiente.

---

## Archivos que NO tocar sin razón

| Archivo | Por qué |
|---|---|
| `src/core/events.js` | Si se modifica un payload, subir `EVENT_CONTRACT_VERSION` |
| `src/sensors/SensorConfig.js` | Los rangos afectan a RuleEngine, TelemetryPanel y ColorMapper |
| `src/sensors/SensorSceneMap.js` | Los nombres deben coincidir EXACTAMENTE con ModelFactory |
| `src/sensors/SensorState.js` | Singleton compartido — getTrend() es ahora parte del contrato |
| `src/scene/ColorMapper.js` | getSensorState() usado por TelemetryPanel y SensorDetailModal |