# Digital Twin Starter Kit — Product Document
### Water Treatment Plant Edition

> Documento vivo. Actualizar cada vez que se tome una decisión técnica o cambie la arquitectura.
>
> Última actualización: Iteración 7 (MCP integration, UI panels de configuración, KPIEngine, PayloadMapper, WebhookManager, Sparkplug support)

---

## Qué es este proyecto

Un starter kit open source que permite a cualquier desarrollador industrial levantar un **gemelo digital funcional de una planta de tratamiento de agua potable en menos de 30 minutos**. Sin backend, sin base de datos, sin servidor propio. Funciona 100% en el navegador.

El objetivo no es ser una plataforma completa. Es vivir exactamente en el medio entre los repos demasiado simples (solo Three.js sin datos) y los demasiado complejos (Docker, servidor, autenticación). Ese gap es el que genera stars en GitHub y forks reales.

> **Vertical elegido: Water Treatment Plant.**
>
> Motivos: mayor actividad open source en 2025, sensores universalmente comprensibles (pH, caudal, cloro, presión), flujo de proceso lineal y visualmente intuitivo, demanda real de desarrolladores municipales y de utilities que buscan exactamente esto en GitHub, y los competidores open source existentes son todos heavyweights con Docker y backend (FUXA, ThingsBoard, iTwin.js). Nadie ha hecho el starter kit ligero.

---

## Por qué Water Treatment Plant (y no Generic Factory)

|  | Generic Factory (descartado) | Water Treatment Plant (elegido) |
| --- | --- | --- |
| **Búsquedas** | Caso de uso más buscado, también el más saturado | Búsquedas específicas sin respuesta open source ligera |
| **Competencia** | Decenas de repos heavyweights ya hechos | 0 starter kits ligeros existentes |
| **Audiencia** | "Generic" no tiene fans — sin comunidad fiel | Ingenieros municipales y utilities buscan esto activamente |
| **Sensores** | Genéricos, difíciles de identificar sin contexto | pH, caudal, cloro, presión: comprensibles sin contexto |
| **Visualización** | Flujo de proceso complejo de representar | Flujo lineal: captación → filtrado → cloración → distribución |
| **Sharing** | Nadie comparte un repo de fábrica genérica | Un ingeniero de agua que lo ve lo manda a 10 colegas |

---

## Stack tecnológico

| Capa | Tecnología | Decisión |
| --- | --- | --- |
| Bundler / Dev | **Vite** | HMR sin recargar WebGL. Build estático a `dist/`. Sin configuración. |
| Módulos | **ES Modules nativos** | Sin framework. Máxima portabilidad, máxima legibilidad para quien forkea. |
| 3D Engine | **Three.js** | WebGL2. WebGPU aún no tiene soporte universal. |
| Modelo 3D | **Procedural (Three.js)** | Cero dependencias externas. Sin licencias ambiguas. El código del modelo es parte del aprendizaje del repo. |
| Datos RT | **Simulador en Web Worker** | Protege el render loop de Three.js. Enchufable a broker MQTT real con config mínima. |
| IA | **RuleEngine determinista (MVP)** | Cero descarga, cero latencia. WebLLM movido a V2.0. |
| Geolocalización | **Leaflet + OSM** | Gratis forever. Mapbox cuesta a escala. |
| Deploy | **GitHub Pages / Vercel** | Build estático de Vite. Gratis, sin VPS. |

### Por qué NO WebLLM en el MVP

700MB de descarga en la primera visita de un usuario que quiere ver un demo. La tasa de abandono es del ~90% antes de ver algo funcionar. Las estrellas vienen de gente que llega al repo, abre el live demo, dice "wow" y le da star. Si el "wow" tarda 5 minutos en cargar, no hay stars.

Problema adicional: `postMessage` entre threads **copia** los datos en lugar de compartirlos. Con 10 sensores ya hay overhead de serialización cada 500ms. Añadir 700MB de modelo encima de eso es inviable para el demo.

WebLLM sigue en el roadmap como **V2.0 opt-in** — rama separada, documentada, pero no en el MVP.

### Por qué NO Next.js

Next.js aporta SSR, SSG, routing y API routes. Este proyecto no necesita ninguna de las tres. Three.js necesita `window` y `document`, lo que en Next.js obliga a `dynamic imports` con `ssr: false` en casi todo. Es fricción innecesaria. Vite da exactamente lo mismo sin el overhead.

### Por qué NO Web Components

Shadow DOM y el custom elements registry añaden complejidad sin aportar nada en este contexto. Se usan **clases JS simples** que manipulan el DOM directamente. Más legibles, más fáciles de forkear.

---

## Arquitectura de Workers

El main thread de Three.js es precioso. Si se bloquea, el render se degrada. Por eso la lógica pesada vive en Workers separados.

```
Main Thread                         sensor.worker.js
────────────────────                ─────────────────────────
Three.js render loop       ←───     SensorSimulator
DOM manipulation        postMessage  NoiseGenerator
EventBus dispatch          (objeto  Threshold pre-eval
SceneUpdater               único,
TelemetryPanel             todos
ColorMapper                sensores,
AlertSystem                timestamp)
RuleEngine
SensorState (singleton)
```

**Regla crítica del Worker:** El Worker envía **un único objeto por tick** con todos los sensores y un timestamp. Nunca envía lecturas individuales aisladas. El main thread tiene un flag `isProcessing` que descarta mensajes mientras actualiza la escena — esto evita acumulación de mensajes en renders lentos o escenas complejas.

---

## ⚠️ Decisiones de arquitectura cerradas

Estas decisiones deben estar tomadas antes de escribir el primer módulo. Si se dejan para después, hay refactor garantizado.

### Decisión 1 — Formato del payload del Worker

El objeto que `sensor.worker.js` envía al main thread tiene siempre esta forma:

```js
{
  timestamp: 1234567890,
  readings: {
    inlet_flow: 142.3,
    coag_ph: 7.1,
    raw_turbidity: 4.2,
    // ... todos los sensores en el mismo tick
  }
}
```

Un único objeto. Todos los sensores. Con timestamp. El `RuleEngine` **solo evalúa snapshots completos** — nunca lecturas individuales aisladas. Esto garantiza correlaciones temporales correctas.

**Política de valores inválidos en el simulador:** si un sensor no puede generar un valor en un tick (error interno, NaN producido por el generador de ruido), el Worker envía el **último valor válido conocido** para ese sensor — nunca `null`, nunca `undefined`, nunca omite la clave. Esto garantiza que `SensorState` y `RuleEngine` siempre reciben un objeto con las 10 claves presentes. Si es el primer tick y no hay valor previo, el Worker usa el punto medio del rango `normal` definido en `SensorConfig`. Esta lógica vive íntegramente en el Worker — el main thread nunca hace defensive checks sobre claves ausentes.

### Decisión 2 — Separación estado vs. notificaciones

El `EventBus` es para **notificaciones** ("hubo un cambio"), no para estado. El estado actual de los sensores vive en `SensorState.js`, un singleton plano que siempre refleja la última lectura de cada sensor.

```js
// SensorState.js — la única fuente de verdad del estado actual
const SensorState = {
  readings: {},
  lastTimestamp: null,
  history: [],
  MAX_HISTORY: 360,

  update(snapshot) {
    this.readings = snapshot.readings;
    this.lastTimestamp = snapshot.timestamp;
    this.history.push(snapshot);
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
  },

  get(sensorId) {
    return this.readings[sensorId]; // undefined si aún no hay datos
  },

  isReady() {
    return this.lastTimestamp !== null; // false hasta el primer tick
  }
};
export default SensorState;
```

`TelemetryPanel`, `RuleEngine` y cualquier módulo que necesite el estado actual lo leen de `SensorState`, no del flujo de eventos. El `EventBus` solo emite `EVENTS.SENSOR_UPDATE` para notificar que hay datos nuevos disponibles.

Esto evita el problema de listeners zombies y de tener que reconstituir el estado a partir de eventos perdidos cuando alguien forkea y añade módulos.

### Decisión 3 — Binding sensor → objeto 3D

`SensorSceneMap.js` es la **única fuente de verdad** del binding entre IDs de sensor y nombres de mesh 3D. `SceneUpdater` nunca hardcodea nombres de objetos Three.js — siempre consulta este mapa.

```js
// SensorSceneMap.js
export const SENSOR_SCENE_MAP = {
  inlet_flow:         ['mesh_inlet_pipe', 'mesh_inlet_channel'],
  raw_turbidity:      ['mesh_raw_water_tank'],
  coag_ph:            ['mesh_coag_tank_1', 'mesh_coag_tank_2'],
  filter_1_dp:        ['mesh_filter_1'],
  filter_2_dp:        ['mesh_filter_2'],
  filtered_turbidity: ['mesh_filtered_water_pipe'],
  chlorine_dose:      ['mesh_chlorination_room'],
  residual_chlorine:  ['mesh_distribution_pipe'],
  tank_level:         ['mesh_clearwell_tank'],
  outlet_pressure:    ['mesh_pump_station'],
};
```

Definir los nombres de mesh **antes** de escribir `ModelFactory.js`. El nombre del mesh en Three.js (`mesh.name = 'mesh_inlet_pipe'`) tiene que coincidir exactamente con el mapa.

**Política de IDs desconocidos:** si `SceneUpdater` recibe un sensor ID que no existe en `SensorSceneMap` (sensor añadido en fork, topic MQTT con nombre distinto), emite un `console.warn` en dev mode y lo ignora silenciosamente en producción. Nunca lanza un error que rompa el bucle de actualización. Esta política se documenta explícitamente para que los forks sepan qué esperar.

### Decisión 4 — Límite honesto del MQTTAdapter

El `MQTTAdapter` funciona con brokers que soporten **MQTT sobre WebSocket** (`ws://` o `wss://` con credenciales simples). Para el demo se puede usar `broker.emqx.io:8083` sin configuración adicional.

**Lo que NO soporta** (documentado explícitamente en el README): TLS mutuo con certificados de cliente, que es el estándar en PLCs industriales reales. Los navegadores no pueden hacer TLS mutuo en WebSocket. Para ese caso, el usuario necesita un proxy o gateway — fuera del scope del starter kit.

El README debe ser explícito: "funciona con brokers configurados para `ws://` o `wss://` con credenciales simples. Para instalaciones con TLS mutuo, se necesita un proxy intermedio."

**Ciclo de vida observable del MQTTAdapter ★**

El Adapter expone 4 estados a través del EventBus. `Toolbar.js` y cualquier componente de UI que muestre estado de conexión deben escuchar estos eventos — nunca asumir el estado de conexión sin suscribirse a ellos:

```js
EVENTS.MQTT_CONNECTING     // usuario solicitó conexión, proceso en marcha
EVENTS.MQTT_CONNECTED      // broker confirmó sesión
EVENTS.MQTT_ERROR          // fallo de autenticación, red, o broker caído
EVENTS.MQTT_DISCONNECTED   // sesión terminada (cierre limpio o por error)
```

**Transición Worker ↔ MQTTAdapter y race condition ★**

La orquestación de la pausa/reanudación del Worker es responsabilidad exclusiva de `main.js` — ni `MQTTAdapter` ni el Worker se conocen entre sí. El flujo es:

```js
// En main.js, al arrancar:
EventBus.on(EVENTS.MQTT_CONNECTED, () => {
  SensorWorker.pause();   // envía mensaje 'pause' al Worker — el Worker deja de emitir
  // A partir de aquí MQTTAdapter es la fuente de datos
});

EventBus.on(EVENTS.MQTT_ERROR, () => SensorWorker.resume());
EventBus.on(EVENTS.MQTT_DISCONNECTED, () => SensorWorker.resume());
```

`SensorWorker.pause()` envía un mensaje `{ cmd: 'pause' }` al Worker thread. El Worker completa el tick en curso y luego detiene el intervalo. Esto significa que puede llegar **un tick más del Worker** después de que `MQTT_CONNECTED` se emita — es aceptable y esperado. `SensorState` y los consumidores están diseñados para recibir snapshots de cualquier fuente; la fuente no está etiquetada en el payload y no necesita estarlo. El payload del MQTTAdapter tiene exactamente la misma forma que el del Worker: `{ timestamp, readings }`.

Si llega `MQTT_ERROR` o `MQTT_DISCONNECTED`, el Worker retoma automáticamente. La UI nunca queda en un estado de conexión ambiguo.

### Decisión 5 — Convención de limpieza de subscripciones

Cada módulo que se suscribe al EventBus **debe** implementar un método `destroy()` que llame a `EventBus.off()`. Esta convención se documenta y se muestra en el primer módulo que use EventBus — los forkeros copian el patrón del código de ejemplo.

```js
// Patrón obligatorio en todos los módulos con subscripciones
class TelemetryPanel {
  constructor() {
    this._onSensorUpdate = this._handleUpdate.bind(this);
    EventBus.on(EVENTS.SENSOR_UPDATE, this._onSensorUpdate);
  }
  _handleUpdate(snapshot) { /* ... */ }
  destroy() {
    EventBus.off(EVENTS.SENSOR_UPDATE, this._onSensorUpdate);
  }
}
```

Sin esto, los listeners zombies se acumulan al reiniciar módulos — especialmente visible cuando alguien forkea y añade hot-reload o reinicio de simulación.

### Decisión 6 — Contrato de salida del RuleEngine ★

El RuleEngine evalúa snapshots completos y emite `EVENTS.RULE_TRIGGERED` con un objeto `alert` de forma fija. **Este contrato no puede cambiar sin versionar el EventBus** — `AlertPanel.js` y `AlertSystem.js` dependen de él directamente.

```js
// alert shape — contrato de salida del RuleEngine
{
  id: 'filter_clogged_1',                          // único, para deduplicar alertas repetidas
  severity: 'warning' | 'danger',                  // determina color y prioridad en UI
  sensorIds: ['filter_1_dp', 'filtered_turbidity'], // qué sensores dispararon la regla
  message: 'Filter #1 may be clogged',             // texto legible por humanos
  timestamp: 1234567890,                            // del snapshot que disparó la regla
  active: true                                      // false cuando la condición se resuelve
}
```

- **`id`** único: imprescindible para deduplicar. Sin él, una condición persistente genera spam de alertas idénticas.
- **`sensorIds`**: `AlertSystem.js` lo usa para saber qué meshes iluminar. Sin esto, no hay feedback visual localizado.
- **`active`**: mecanismo de resolución. Cuando la condición vuelve a rango normal, el RuleEngine emite el mismo `id` con `active: false`. `AlertPanel.js` elimina la alerta; `AlertSystem.js` quita el overlay; `ColorMapper.js` vuelve al color normal.

**Versionado del contrato:** `events.js` exporta una constante `EVENT_CONTRACT_VERSION = '1'`. Si en una versión futura se modifica la forma de cualquier payload, esta versión sube. Los forks que dependan de la forma del payload pueden hacer un check explícito. No hay mecanismo de migración automática — la versión es solo un indicador visible para quien forkea.

### Decisión 7 — Flujo de resolución de alertas ★

Una alerta no es un evento de disparo único — tiene un ciclo de vida. El RuleEngine evalúa en cada tick y gestiona el estado activo de cada regla internamente:

```js
// RuleEngine mantiene este registro interno
const activeAlerts = new Map(); // id → alert object

// En cada tick, para cada regla:
if (condicionDisparada && !activeAlerts.has(id)) {
  const alert = { id, severity, sensorIds, message, timestamp, active: true };
  activeAlerts.set(id, alert);
  EventBus.emit(EVENTS.RULE_TRIGGERED, alert);
}

if (!condicionDisparada && activeAlerts.has(id)) {
  const resolved = { ...activeAlerts.get(id), active: false, timestamp };
  activeAlerts.delete(id);
  EventBus.emit(EVENTS.RULE_TRIGGERED, resolved); // mismo evento, active: false
}
```

Usar un único evento (`RULE_TRIGGERED`) con `active: true/false` en lugar de dos eventos separados simplifica la lógica de los consumidores — solo necesitan un listener que comprueba `alert.active`.

**Recuperación de estado de alertas tras reinicio de UI:** `RuleEngine` expone un método `getActiveAlerts()` que devuelve una copia del mapa interno como array. Cualquier módulo que se inicialice después del arranque (o se reinicialice tras hot reload) puede llamar a este método para recuperar el estado actual sin esperar al próximo tick:

```js
// En AlertPanel.init() — recupera alertas activas existentes
RuleEngine.getActiveAlerts().forEach(alert => this._render(alert));
```

### Decisión 8 — Catálogo centralizado de eventos ★

Todos los nombres de eventos del EventBus viven en un único objeto `EVENTS` exportado. Ningún módulo usa strings literales de eventos — siempre importa de este catálogo. Esto hace los errores de typo detectables con grep y los forks más legibles.

```js
// src/core/events.js — fuente de verdad de todos los eventos del sistema
export const EVENT_CONTRACT_VERSION = '1';

export const EVENTS = {
  // Datos de sensores
  SENSOR_UPDATE:     'sensor:update',      // payload: { timestamp: number, readings: Record<string, number> }

  // Reglas y alertas
  RULE_TRIGGERED:    'rule:triggered',     // payload: Alert (ver Decisión 6) — active: true o false

  // Ciclo de vida MQTT
  MQTT_CONNECTING:   'mqtt:connecting',    // payload: { brokerUrl: string }
  MQTT_CONNECTED:    'mqtt:connected',     // payload: { brokerUrl: string, topic: string }
  MQTT_ERROR:        'mqtt:error',         // payload: { brokerUrl: string, reason: string }
  MQTT_DISCONNECTED: 'mqtt:disconnected',  // payload: { brokerUrl: string, clean: boolean }

  // Exportación
  EXPORT_STARTED:    'export:started',     // payload: { format: 'json' | 'csv' }
  EXPORT_COMPLETE:   'export:complete',    // payload: { format: 'json' | 'csv', rowCount: number }
};
```

El comentario de payload en cada evento es el contrato. Si alguien escucha `MQTT_CONNECTED` y quiere mostrar el nombre del broker, sabe exactamente qué campo leer. Regla: si un módulo nuevo necesita un evento que no existe, lo añade aquí primero, **con su payload documentado**. Nunca inline.

### Decisión 9 — Buffer de histórico en SensorState ★

`SensorState` no guarda solo la última lectura — mantiene un circular buffer de los últimos N snapshots. El tamaño del buffer está definido como constante y no crece indefinidamente.

```js
// SensorState.js — con histórico circular
const SensorState = {
  readings: {},
  lastTimestamp: null,
  history: [],
  MAX_HISTORY: 360,        // 3 minutos a 500ms por tick = 360 snapshots (~72KB en memoria)

  update(snapshot) {
    this.readings = snapshot.readings;
    this.lastTimestamp = snapshot.timestamp;
    this.history.push(snapshot);
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
  },

  get(sensorId) {
    return this.readings[sensorId];
  },

  isReady() {
    return this.lastTimestamp !== null;
  },

  getHistory(sensorId, n = this.MAX_HISTORY) {
    return this.history.slice(-n).map(s => ({
      timestamp: s.timestamp,
      value: s.readings[sensorId]
    }));
  },

  reset() {
    this.readings = {};
    this.lastTimestamp = null;
    this.history = [];
  }
};
export default SensorState;
```

360 snapshots × ~200 bytes por snapshot ≈ 72KB. Completamente razonable en browser.

**Política de reset:** cuando el usuario cambia de fuente de datos (simulador → MQTT real o viceversa), `main.js` llama a `SensorState.reset()` antes de activar la nueva fuente. Esto garantiza que `DataExporter` nunca exporta datos mezclados de dos fuentes distintas. `RuleEngine` también hace `activeAlerts.clear()` en el mismo momento para evitar alertas huérfanas de la sesión anterior. El reset lo orquesta siempre `main.js` — nunca el Adapter ni el Worker.

### Decisión 10 — Validación de SensorConfig en dev mode ★

`SensorConfig.js` es el contrato más importante del repo — si alguien forkea y añade un sensor con un campo mal escrito, el error aparece lejos de la fuente. Un validador mínimo en dev mode lo detecta en el arranque.

```js
// SensorConfig.js — al final del archivo, solo en dev
const REQUIRED_FIELDS = ['id', 'unit', 'normal', 'warning', 'danger'];

if (import.meta.env.DEV) {
  SENSORS.forEach(sensor => {
    REQUIRED_FIELDS.forEach(field => {
      if (!(field in sensor)) {
        throw new Error(`SensorConfig: sensor "${sensor.id ?? '?'}" missing field "${field}"`);
      }
    });
    if (sensor.normal.min >= sensor.normal.max) {
      throw new Error(`SensorConfig: sensor "${sensor.id}" has invalid normal range`);
    }
  });
}
```

El validador solo corre en `import.meta.env.DEV` — cero overhead en producción. El error apunta al sensor exacto y al campo que falta.

### Decisión 11 — Orden de inicialización en main.js ★

`main.js` orquesta el arranque en una función `init()` asíncrona con orden explícito. El Worker arranca **el último**, después de que todos los listeners estén registrados. Si arranca antes, el primer tick llega sin consumidores y se pierde silenciosamente — un bug no obvio que aparece en máquinas lentas.

```js
// main.js
import { EVENTS } from './core/events.js';
import SceneManager from './core/SceneManager.js';
import ModelFactory from './core/ModelFactory.js';
import AnimationLoop from './core/AnimationLoop.js';
import SensorState from './sensors/SensorState.js';
import RuleEngine from './sensors/RuleEngine.js';
import TelemetryPanel from './ui/TelemetryPanel.js';
import AlertPanel from './ui/AlertPanel.js';
import Toolbar from './ui/Toolbar.js';
import MiniMap from './ui/MiniMap.js';
import SceneUpdater from './scene/SceneUpdater.js';
import SensorWorker from './sensors/SensorWorker.js';

async function init() {
  // 1. Escena — el renderer tiene que existir antes de cualquier mesh
  await SceneManager.init();
  await ModelFactory.build();      // nombres de mesh según SensorSceneMap

  // 2. AnimationLoop — arranca después de que la escena exista,
  //    antes de que lleguen datos (el primer frame renderiza la escena vacía sin errores)
  AnimationLoop.start(SceneManager.renderer, SceneManager.scene, SceneManager.camera);

  // 3. Estado y lógica — listos para recibir datos
  SensorState.init();
  RuleEngine.init();

  // 4. UI — subscripciones al EventBus registradas antes del primer tick.
  //    Toolbar y MiniMap se inicializan aquí aunque no consuman datos de sensor:
  //    Toolbar necesita escuchar MQTT_* desde el inicio para mostrar el estado de conexión.
  //    MiniMap no tiene subscripciones de EventBus pero se inicializa en el mismo paso por consistencia.
  TelemetryPanel.init();
  AlertPanel.init();
  SceneUpdater.init();
  Toolbar.init();
  MiniMap.init();

  // 5. Orquestación Worker ↔ MQTT — registrada antes de que el Worker arranque
  EventBus.on(EVENTS.MQTT_CONNECTED,    () => SensorWorker.pause());
  EventBus.on(EVENTS.MQTT_ERROR,        () => SensorWorker.resume());
  EventBus.on(EVENTS.MQTT_DISCONNECTED, () => SensorWorker.resume());

  // 6. Worker — SIEMPRE el último
  //    En este punto todos los listeners están registrados y ningún tick se pierde
  SensorWorker.start();
}

// Estrategia de error visible — nunca pantalla en blanco para el usuario
init().catch(err => {
  console.error('Init failed:', err);
  const root = document.getElementById('app') ?? document.body;
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#e55;background:#111;">
      <h2>Failed to initialize</h2>
      <p>${err.message}</p>
      <p style="color:#888;font-size:0.8em;">Check the console for details. WebGL may not be available in this browser.</p>
    </div>`;
});
```

Regla: cualquier módulo que se añada en un fork debe inicializarse en el paso 4, **antes** de `SensorWorker.start()`. Esta función es el único punto de entrada y el único lugar donde se gestiona el orden de arranque.

### Decisión 12 — Estado inicial de SensorState y comportamiento de la UI antes del primer tick ★

Entre el arranque de `init()` y la llegada del primer tick del Worker (~500ms), `SensorState.readings` es `{}` y `SensorState.isReady()` devuelve `false`. Los módulos que leen de `SensorState` deben manejar este estado explícitamente:

- **`TelemetryPanel`**: muestra `—` (guión largo) para cada sensor hasta que `isReady()` es `true`.
- **`SceneUpdater`**: no actualiza colores de meshes hasta el primer tick — los meshes muestran el material por defecto definido en `ModelFactory`.
- **`RuleEngine`**: no evalúa reglas si `isReady()` es `false` — evita false positives con valores vacíos.
- **`DataExporter`**: si `history` está vacío, el export devuelve un archivo válido pero con 0 filas y un comentario `# No data recorded yet`.

Este comportamiento es **explícito y documentado** — no es un edge case que cada módulo resuelve a su manera. El patrón es: comprobar `SensorState.isReady()` antes de actuar, y renderizar un estado neutro mientras no hay datos.

### Decisión 13 — Prioridad de ColorMapper vs AlertSystem sobre el color de los meshes ★

`ColorMapper` y `AlertSystem` tocan ambos el color de los meshes 3D, pero con responsabilidades distintas y **sin conflicto** porque operan en capas separadas:

- **`ColorMapper`** modifica el `material.color` del mesh directamente en función del valor del sensor. Se aplica en cada tick vía `SceneUpdater`. Es el color base del objeto.
- **`AlertSystem`** añade un overlay independiente (un mesh semitransparente superpuesto, o un `emissive` distinto si el material lo soporta) para indicar alerta activa. No toca `material.color` — opera sobre una propiedad distinta.

Cuando una alerta se resuelve (`active: false`), `AlertSystem` elimina su overlay. El mesh recupera visualmente el color base que `ColorMapper` ha seguido actualizando en cada tick — no hay estado stale ni conflicto.

```js
// ColorMapper — toca material.color
mesh.material.color.set(colorForValue(value, sensorConfig));

// AlertSystem — toca material.emissiveIntensity (capa separada)
mesh.material.emissive.set(0xff2200);
mesh.material.emissiveIntensity = alert.active ? 0.4 : 0.0;
```

**Regla:** `ColorMapper` nunca toca `emissive`. `AlertSystem` nunca toca `color`. Esta separación de capas es la única fuente de verdad sobre cómo se combinan los dos sistemas visuales. Si el material de un mesh no soporta `emissive` (e.g., `MeshBasicMaterial`), `ModelFactory` debe usar `MeshStandardMaterial` o `MeshPhongMaterial` — esto es un requisito de `ModelFactory`, no de `AlertSystem`.

### Decisión 14 — Correlaciones en el simulador ★

Sin correlaciones entre sensores, el `RuleEngine` nunca detecta las situaciones de proceso que justifican su existencia en el demo. El simulador no puede generar valores completamente independientes.

`sensor.worker.js` implementa un modelo de correlaciones mínimo basado en relaciones causales reales del proceso:

```js
// Correlaciones implementadas en sensor.worker.js
// Cada tick, el simulador calcula los valores en este orden (causal):

// 1. inlet_flow es independiente — el driver primario del sistema
inlet_flow = baseValue + noise();

// 2. raw_turbidity correlaciona ligeramente con inlet_flow
//    (más caudal → más sedimentos en suspensión)
raw_turbidity = base_turbidity + (inlet_flow / 200) * 2.0 + noise();

// 3. chlorine_dose debe escalar con inlet_flow
//    (más agua → más cloro necesario)
//    Si NO escala, el RuleEngine detecta déficit de desinfección
chlorine_dose = base_dose * (inlet_flow / 150) + noise();

// 4. filter_dp sube lentamente con el tiempo (colmatación progresiva)
//    Se resetea cuando alcanza danger (simulación de retrolavado)
filter_1_dp = Math.min(filter_1_dp_current + 0.1 + noise(), 250);
if (filter_1_dp > 200) filter_1_dp = 20; // retrolavado simulado

// 5. filtered_turbidity correlaciona con filter_dp
//    (filtro colmatado → peor filtración)
filtered_turbidity = 0.2 + (filter_1_dp / 200) * 0.8 + noise();
```

Estas correlaciones son las que hacen que las reglas de correlación del `RuleEngine` se disparen de forma realista durante el demo. Sin ellas, las alertas de correlación nunca aparecen porque los sensores no se mueven juntos.

Los valores de `noise()` usan `NoiseGenerator.js` para suavidad temporal — no ruido blanco puro.

### Decisión 15 — Estructura interna de las reglas del RuleEngine ★

El `RuleEngine` es el módulo más probable de ser modificado en un fork. Su estructura interna debe ser legible y extensible sin necesidad de entender el resto del sistema.

Cada regla es un objeto con una forma fija:

```js
// Estructura de una regla — contrato interno de RuleEngine
const RULES = [
  {
    id: 'filter_clogged_1',               // único, inmutable
    severity: 'warning',                  // 'warning' | 'danger'
    sensorIds: ['filter_1_dp', 'filtered_turbidity'],
    message: 'Filter #1 may be clogged — high DP with turbidity breakthrough',
    condition: (readings) => {
      // readings es el objeto completo del snapshot
      // La función devuelve true si la alerta debe estar activa
      return readings.filter_1_dp > 150 && readings.filtered_turbidity > 0.5;
    }
  },
  {
    id: 'chlorine_deficit',
    severity: 'danger',
    sensorIds: ['inlet_flow', 'chlorine_dose'],
    message: 'Chlorine dose not scaling with flow — disinfection deficit risk',
    condition: (readings) => {
      const expectedDose = 1.0 * (readings.inlet_flow / 150);
      return readings.chlorine_dose < expectedDose * 0.7;
    }
  },
  // ... más reglas
];
```

El `RuleEngine` itera sobre `RULES` en cada tick, llama a `rule.condition(snapshot.readings)` y gestiona el ciclo de vida de la alerta (Decisión 7). Para añadir una regla nueva en un fork, el desarrollador solo necesita añadir un objeto al array `RULES` — no toca la lógica de evaluación ni el ciclo de vida.

```js
// RuleEngine.js — lógica de evaluación (no necesita tocarse para añadir reglas)
function evaluate(snapshot) {
  RULES.forEach(rule => {
    const triggered = rule.condition(snapshot.readings);
    if (triggered && !activeAlerts.has(rule.id)) {
      const alert = {
        id: rule.id,
        severity: rule.severity,
        sensorIds: rule.sensorIds,
        message: rule.message,
        timestamp: snapshot.timestamp,
        active: true
      };
      activeAlerts.set(rule.id, alert);
      EventBus.emit(EVENTS.RULE_TRIGGERED, alert);
    }
    if (!triggered && activeAlerts.has(rule.id)) {
      const resolved = { ...activeAlerts.get(rule.id), active: false, timestamp: snapshot.timestamp };
      activeAlerts.delete(rule.id);
      EventBus.emit(EVENTS.RULE_TRIGGERED, resolved);
    }
  });
}

// API pública de RuleEngine
export default {
  init() { /* registra listener SENSOR_UPDATE */ },
  getActiveAlerts() { return [...activeAlerts.values()]; },
  destroy() { /* limpia listener */ }
};
```

### Decisión 16 — API de NoiseGenerator ★

`NoiseGenerator.js` es importado por `sensor.worker.js`. Si la firma de función no está definida antes de escribir el Worker, Claude inventa una API en cada archivo y los dos no encajan.

La API expone una única función con estado interno por `sensorId`. El estado interno (fase acumulada) garantiza suavidad temporal — valores consecutivos no dan saltos bruscos:

```js
// NoiseGenerator.js — API completa
// Internamente mantiene un mapa de fase por sensorId para suavidad temporal.
// No necesita inicialización externa — el estado se crea en el primer uso.

const phases = {};

/**
 * Genera un valor de ruido suavizado para un sensor.
 * @param {string} sensorId  - ID del sensor (e.g. 'inlet_flow'). Usado para aislar la fase.
 * @param {number} amplitude - Magnitud máxima del ruido (± amplitude alrededor de 0).
 * @param {number} speed     - Velocidad de cambio. 0.01 = muy lento, 0.1 = rápido.
 * @returns {number}         - Valor de ruido en el rango [-amplitude, +amplitude].
 */
export function noise(sensorId, amplitude, speed = 0.03) {
  if (phases[sensorId] === undefined) phases[sensorId] = Math.random() * Math.PI * 2;
  phases[sensorId] += speed;
  return Math.sin(phases[sensorId]) * amplitude;
}

/**
 * Resetea la fase de todos los sensores.
 * Llamar desde main.js en SensorState.reset() si se quiere reiniciar el simulador limpio.
 */
export function resetNoise() {
  Object.keys(phases).forEach(k => delete phases[k]);
}
```

Uso en `sensor.worker.js`:

```js
import { noise } from './NoiseGenerator.js';

// Ejemplo — inlet_flow varía ±15 m³/h con velocidad media
inlet_flow = 120 + noise('inlet_flow', 15, 0.03);
```

Cada sensor tiene su propia fase independiente porque usa su `sensorId` como clave. Sin esto, todos los sensores oscilarían en sincronía, lo que se ve artificial inmediatamente.

### Decisión 17 — Composición visual de la escena 3D ★

Sin estas especificaciones, `ModelFactory.js` toma 20 decisiones arbitrarias de tamaño, posición y cámara. El resultado puede ser funcional pero visualmente desordenado, y cada corrección posterior requiere ajustar coordenadas en cascada.

**Sistema de coordenadas:** Y es el eje vertical. La planta se extiende en el plano XZ. Toda la geometría se construye a Y ≥ 0 (el suelo está en Y = 0).

**Layout de la planta — vista cenital (eje Z es "profundidad", eje X es "anchura"):**

```
Z = 0  ┌─────────────────────────────────────────────────────┐
       │  [INLET]     [COAG×2]   [FILTERS×2]  [CHLOR]       │
       │  X=-18       X=-8,−4    X=4, 8       X=16          │
       │                                                     │
       │              [RAW TANK]  [CLEAR TANK] [PUMPS]       │
       │              X=-6        X=12         X=20          │
Z = 20 └─────────────────────────────────────────────────────┘
```

**Dimensiones de referencia por mesh:**

| Mesh | Geometría | Ancho × Alto × Prof (u) | Posición (X, Y, Z) |
| --- | --- | --- | --- |
| `mesh_inlet_channel` | BoxGeometry | 4 × 0.5 × 2 | (−20, 0.25, 10) |
| `mesh_inlet_pipe` | CylinderGeometry r=0.3 | — | (−18, 1, 10) |
| `mesh_coag_tank_1` | CylinderGeometry r=1.5 | h=3 | (−8, 1.5, 8) |
| `mesh_coag_tank_2` | CylinderGeometry r=1.5 | h=3 | (−4, 1.5, 8) |
| `mesh_raw_water_tank` | BoxGeometry | 6 × 2 × 10 | (−6, 1, 14) |
| `mesh_filter_1` | CylinderGeometry r=2 | h=3 | (4, 1.5, 8) |
| `mesh_filter_2` | CylinderGeometry r=2 | h=3 | (8, 1.5, 8) |
| `mesh_filtered_water_pipe` | TubeGeometry | r=0.3 | (4→12, 1, 8) |
| `mesh_chlorination_room` | BoxGeometry | 4 × 3 × 4 | (16, 1.5, 10) |
| `mesh_clearwell_tank` | BoxGeometry | 8 × 3 × 8 | (12, 1.5, 14) |
| `mesh_pump_station` | BoxGeometry | 3 × 2.5 × 3 | (20, 1.25, 10) |
| `mesh_distribution_pipe` | CylinderGeometry r=0.4 | h=6 | (20, 3, 10) |

Las unidades son arbitrarias (Three.js no tiene unidad física). Lo importante es que la escala relativa es coherente: los tanques son más grandes que las tuberías, el clearwell es el objeto más voluminoso.

**Suelo:** un `PlaneGeometry` de 50 × 30 u, rotado −90° en X, en Y = 0, con `MeshStandardMaterial` color `#2a3a2a` (gris verdoso industrial). No tiene nombre de mesh — no es un objeto funcional.

**Cámara inicial:**

```js
camera.position.set(0, 22, 30);   // elevada y ligeramente alejada en Z
camera.lookAt(0, 0, 10);          // apunta al centro de la planta
```

Esto da una vista isométrica aproximada que muestra toda la planta sin recortar ningún objeto. `OrbitControls` permiten al usuario rotar libremente desde ahí.

**Iluminación:**

```js
// Luz ambiental base — evita sombras completamente negras
new THREE.AmbientLight(0xffffff, 0.4);

// Luz direccional principal — simula sol desde arriba-derecha
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(10, 20, 10);
```

Sin más luces. Sencillo, suficiente para que `MeshStandardMaterial` muestre los colores de `ColorMapper` correctamente.

### Decisión 18 — Topic structure y formato de payload MQTT real ★

Sin esto, `MQTTAdapter.js` no sabe cómo parsear los mensajes del broker, y quien conecte un broker real a su propia instalación no sabe qué formato publicar.

**Topic structure:**

El Adapter suscribe a **un único topic wildcard**. Todos los sensores llegan en un único mensaje JSON por publicación. No hay un topic por sensor — eso generaría 10 suscripciones y el problema de reconstitución de snapshots sincronizados en el cliente.

```
Topic de suscripción: wtp/plant/{plantId}/sensors
Topic de ejemplo:     wtp/plant/plant-01/sensors
```

`plantId` es configurable en `Toolbar.js` (campo de texto, valor por defecto `plant-01`). Esto permite que varios usuarios del starter kit conecten plantas distintas al mismo broker de demo sin colisiones.

**Formato del mensaje (payload JSON publicado en el topic):**

```json
{
  "timestamp": 1234567890123,
  "readings": {
    "inlet_flow": 142.3,
    "raw_turbidity": 4.2,
    "coag_ph": 7.1,
    "filter_1_dp": 98.0,
    "filter_2_dp": 102.5,
    "filtered_turbidity": 0.28,
    "chlorine_dose": 1.8,
    "residual_chlorine": 0.45,
    "tank_level": 67.0,
    "outlet_pressure": 4.2
  }
}
```

El formato es idéntico al payload del Worker (Decisión 1) — esto es intencionado. `SensorState.update()` recibe el mismo objeto independientemente de la fuente.

**Parsing en MQTTAdapter:**

```js
client.on('message', (topic, message) => {
  let snapshot;
  try {
    snapshot = JSON.parse(message.toString());
  } catch (e) {
    console.warn('MQTTAdapter: mensaje no válido ignorado', e);
    return; // nunca propagar un parse error al resto del sistema
  }

  // Validación mínima — debe tener timestamp y readings
  if (!snapshot.timestamp || !snapshot.readings) {
    console.warn('MQTTAdapter: payload sin forma esperada ignorado', snapshot);
    return;
  }

  // Mismo flujo que el Worker
  SensorState.update(snapshot);
  EventBus.emit(EVENTS.SENSOR_UPDATE, snapshot);
});
```

**Broker de demo para desarrollo:** `broker.emqx.io:8083` (WebSocket no seguro). Para producción con `wss://`, usar `broker.emqx.io:8084`. Ambas opciones se documentan en `README.md` y en los comentarios de `MQTTAdapter.js`.

**Para publicar desde una instalación real** (ejemplo Python):

```python
import paho.mqtt.client as mqtt, json, time

client = mqtt.Client()
client.connect("broker.emqx.io", 1883)

payload = {
    "timestamp": int(time.time() * 1000),
    "readings": { "inlet_flow": 142.3, ... }
}
client.publish("wtp/plant/plant-01/sensors", json.dumps(payload))
```

Este snippet va en `docs/mqtt-production.md` — referenciado desde el README en la sección "Connect your real MQTT broker".

---

## Sensores definidos — Planta de tratamiento de agua

10 sensores con vinculación directa a objetos 3D en la escena, siguiendo el flujo real del proceso:

| ID | Nombre | Tipo | Rango normal | Warning | Danger | Etapa del proceso |
| --- | --- | --- | --- | --- | --- | --- |
| `inlet_flow` | Inlet Flow Rate | m³/h | 50–200 | <40 o >220 | <20 o >250 | Captación |
| `raw_turbidity` | Raw Water Turbidity | NTU | 1–10 | 10–50 | >50 | Captación |
| `coag_ph` | Coagulation pH | pH | 6.5–7.5 | 6.0–6.5 / 7.5–8.0 | <6.0 o >8.0 | Coagulación |
| `filter_1_dp` | Filter #1 Differential Pressure | mbar | 20–150 | 150–200 | >200 | Filtración |
| `filter_2_dp` | Filter #2 Differential Pressure | mbar | 20–150 | 150–200 | >200 | Filtración |
| `filtered_turbidity` | Filtered Water Turbidity | NTU | 0.1–0.5 | 0.5–1.0 | >1.0 | Post-filtración |
| `chlorine_dose` | Chlorine Dose | mg/L | 1.0–3.0 | 0.5–1.0 / 3.0–4.0 | <0.5 o >4.0 | Cloración |
| `residual_chlorine` | Residual Chlorine | mg/L | 0.2–1.0 | 0.1–0.2 / 1.0–1.5 | <0.1 o >1.5 | Distribución |
| `tank_level` | Clearwell Tank Level | % | 40–90 | 20–40 / 90–95 | <20 o >95 | Almacenamiento |
| `outlet_pressure` | Distribution Pressure | bar | 3.0–6.0 | 2.0–3.0 / 6.0–7.0 | <2.0 o >7.0 | Distribución |

---

## Arquitectura de IA (simplificada — dos niveles)

La IA no es monolítica. El MVP usa solo el Nivel 1. El Nivel 2 es V2.0.

**Nivel 1 — RuleEngine (MVP, siempre activo, sin descarga)**

- Evalúa thresholds de cada sensor en tiempo real
- Detecta correlaciones de proceso evaluando **snapshots completos** (nunca lecturas aisladas): turbidez filtrada alta + presión diferencial alta = filtro colmatado
- Detecta anomalías de cloración: caudal sube pero dosis cloro no escala → déficit de desinfección
- Genera alertas estructuradas con causa probable siguiendo el contrato de la Decisión 6
- Gestiona el ciclo de vida de alertas (activo / resuelto) según la Decisión 7
- Cero latencia, cero peso, cero descarga

**Nivel 2 — WebLLM + TinyLlama (V2.0, opt-in)**

- Rama separada en el repo (`feature/ai-advisor`)
- El usuario hace click en "Ask AI"
- TinyLlama (~700MB) se descarga y cachea en IndexedDB la primera vez
- Genera diagnóstico en lenguaje natural sobre el estado del proceso
- Corre en `ai.worker.js` — nunca bloquea el render

---

## Flujo de datos completo

```
sensor.worker.js
  │  genera snapshot completo cada 500ms
  │  { timestamp, readings: { all 10 sensors } }
  │  valores inválidos → último valor válido (nunca null, nunca clave ausente)
  │  postMessage → main thread (flag isProcessing protege el render)
  ▼
main.js → SensorState.update(snapshot)    ← actualiza readings + circular buffer
       → EventBus.emit(EVENTS.SENSOR_UPDATE, snapshot)
  │
  ├──▶ RuleEngine.js
  │      solo evalúa si SensorState.isReady() === true
  │      itera RULES[], llama rule.condition(readings)
  │      gestiona activeAlerts internamente (Decisión 7)
  │      EventBus.emit(EVENTS.RULE_TRIGGERED, alert)  ← active: true o false
  │
  ├──▶ SceneUpdater.js
  │      consulta SensorSceneMap → IDs desconocidos: warn en dev, silencio en prod
  │      ColorMapper → toca material.color (capa base)
  │      AlertSystem → toca material.emissiveIntensity (capa overlay, no toca color)
  │      AlertSystem responde a active: false quitando el overlay
  │
  └──▶ TelemetryPanel.js → comprueba isReady() → muestra "—" hasta primer tick

MQTTAdapter.js (cuando usuario conecta broker real)
  │  emite EVENTS.MQTT_CONNECTING → MQTT_CONNECTED (o MQTT_ERROR)
  │  main.js escucha MQTT_CONNECTED → SensorWorker.pause()
  │  main.js escucha MQTT_ERROR/DISCONNECTED → SensorWorker.resume()
  │  main.js llama SensorState.reset() + RuleEngine.clearAlerts() antes del switch
  │  misma forma de payload: { timestamp, readings }
  │  Límite: solo ws:// y wss:// con credenciales simples (no TLS mutuo)
  ▼
  Mismo SensorState → mismo EventBus → mismo flujo → cero cambios en el resto
```

El patrón es **Observable + Adapter + Singleton State**. El Adapter hace que el proyecto sea enchufable a producción real sin reescribir nada.

---

## Estructura de archivos

```
digital-twin-water/
│
├── index.html
├── vite.config.js
├── package.json
├── package-lock.json
├── README.md
├── CONTRIBUTING.md
├── design.md
├── progress.md
├── mcp-server.js              ← MCP server para integración con Claude
├── mcp-bridge-server.js       ← Bridge server para MCP
│
├── .github/
│   └── workflows/
│       └── deploy.yml         ← CI/CD pipeline (GitHub Actions)
│
├── public/                     ← assets estáticos para PWA
│   ├── favicon.svg
│   ├── icon.svg
│   ├── cover.png
│   ├── manifest.json
│   ├── sw.js                  ← service worker
│   └── icons/
│       ├── icon_192.png
│       └── icon_512.png
│
├── docs/                       ← documentación de guías
│   ├── mqtt-production.md      ← guía de configuración MQTT en producción
│   ├── claude-desktop-setup.md ← setup de Claude Desktop
│   ├── 3dmodel.png
│   ├── charts.png
│   ├── cover.png
│   ├── cover_2.png
│   ├── kpis.png
│   ├── mcp_demo_1.png
│   └── mcp_demo_2.png
│
└── src/
    ├── main.js                 ← entry point, orquesta init() con orden explícito
    ├── style.css               ← estilos globales
    │
    ├── core/
    │   ├── SceneManager.js     ← Three.js: renderer, cámara, luces
    │   ├── ModelFactory.js     ← planta WTP procedural (MeshStandardMaterial)
    │   ├── AnimationLoop.js    ← RAF loop con delta time
    │   ├── EventBus.js         ← notificaciones entre módulos
    │   └── events.js           ← catálogo de eventos + EVENT_CONTRACT_VERSION ★
    │
    ├── sensors/
    │   ├── SensorConfig.js     ← definición de los 10 sensores WTP + rangos ★
    │   ├── SensorState.js      ← singleton: estado + circular buffer + isReady() ★
    │   ├── SensorSceneMap.js   ← binding sensor ID → nombre de mesh 3D ★
    │   ├── SensorWorker.js     ← manejo de web workers
    │   ├── sensor.worker.js    ← simulación con correlaciones causales ★
    │   ├── MQTTAdapter.js      ← simulated ↔ real broker (ws/wss) ★
    │   ├── RuleEngine.js       ← array RULES[] + evaluación + activeAlerts ★
    │   └── KPIEngine.js        ← cálculo de KPIs y métricas de rendimiento
    │
    ├── scene/
    │   ├── ColorMapper.js      ← valor numérico → material.color
    │   ├── AlertSystem.js      ← overlay visual vía emissiveIntensity
    │   └── SceneUpdater.js     ← coordina ColorMapper y AlertSystem
    │
    ├── ui/
    │   ├── TelemetryPanel.js   ← panel de telemetría en tiempo real
    │   ├── AlertPanel.js       ← panel de alertas activas
    │   ├── IncidentPanel.js    ← panel de gestión de incidentes
    │   ├── KPIPanel.js         ← panel de visualización de KPIs
    │   ├── MiniMap.js          ← mapa con ubicación de planta (Leaflet)
    │   ├── MobileTabBar.js     ← barra de tabs para mobile
    │   ├── Toolbar.js          ← controles de cámara y configuración
    │   ├── ConfigModal.js      ← modal de configuración general
    │   ├── SensorDetailModal.js ← modal de detalles de sensor
    │   ├── MQTTPanel.js        ← panel de conexión/estado MQTT
    │   ├── PayloadMapperPanel.js ← panel de mapeo de payloads
    │   └── WebhookPanel.js     ← panel de gestión de webhooks
    │
    └── utils/
        ├── NoiseGenerator.js   ← generador de ruido suavizado (Perlin)
        ├── DataExporter.js     ← export JSON/CSV desde historial
        ├── MCPBridge.js        ← comunicación con servidor MCP
        ├── PayloadMapper.js    ← mapeo de payloads MQTT personalizados
        ├── SparkplugParser.js  ← parser para formato Sparkplug
        └── WebhookManager.js   ← gestión de webhooks outbound
```

> ★ Archivos críticos o nuevos en esta iteración.
>
> **Archivos de contrato (deben existir primero):**
> - `events.js` ← todos los módulos lo importan
> - `SensorConfig.js`, `SensorState.js`, `SensorSceneMap.js` ← contratos de arquitectura antes de implementar consumers
>
> **MCP Integration (nuevos en V1.1):**
> - `mcp-server.js`, `mcp-bridge-server.js` ← integración con Claude Desktop
> - `MCPBridge.js`, `PayloadMapper.js`, `SparkplugParser.js` ← utilidades MCP
>
> **UI Panels (nuevos en V1.1):**
> - `ConfigModal.js`, `SensorDetailModal.js`, `IncidentPanel.js`, `KPIPanel.js` ← modales y paneles
> - `MQTTPanel.js`, `PayloadMapperPanel.js`, `WebhookPanel.js` ← paneles de configuración
> - `MobileTabBar.js` ← soporte mobile responsive
>
> **Requisitos arquitectura:**
> - `ModelFactory.js` debe usar `MeshStandardMaterial` en todos los meshes — necesario para `AlertSystem.emissiveIntensity`
> - Sin carpeta `ai/` en MVP. Aparece en rama `feature/ai-advisor` (V2.0)
> - `KPIEngine.js` calcula métricas dinámicamente desde datos de sensores

---

## Modelo 3D de la planta (procedural)

Sin archivos externos. Todo se genera con geometría Three.js siguiendo el flujo real del proceso. Cada mesh recibe un `mesh.name` que coincide exactamente con `SensorSceneMap.js`. **Todos los meshes usan `MeshStandardMaterial`** — requisito para que `AlertSystem` pueda usar `emissive` sin condicionales.

| Etapa | Geometría | Nombre de mesh |
| --- | --- | --- |
| Toma de agua | Canal de entrada (BoxGeometry) | `mesh_inlet_channel`, `mesh_inlet_pipe` |
| Coagulación/floculación | 2 tanques con paletas animadas (CylinderGeometry) | `mesh_coag_tank_1`, `mesh_coag_tank_2` |
| Sedimentación | Tanque rectangular alargado (BoxGeometry) | `mesh_raw_water_tank` |
| Filtros de arena | 2 unidades con lecho visible (CylinderGeometry + capas) | `mesh_filter_1`, `mesh_filter_2` |
| Post-filtración | Tubería de agua filtrada (TubeGeometry) | `mesh_filtered_water_pipe` |
| Cloración | Edificio con tuberías (BoxGeometry + TubeGeometry) | `mesh_chlorination_room` |
| Almacenamiento | Clearwell (BoxGeometry grande) | `mesh_clearwell_tank` |
| Distribución | Estación de bombeo + tuberías de salida | `mesh_pump_station`, `mesh_distribution_pipe` |

---

## Estructura del README (para GitHub)

El README es marketing, no documentación. El orden importa.

```
# Water Treatment Digital Twin — Starter Kit

[GIF de 3 segundos del dashboard funcionando — antes del título]

## Live Demo  ← link a Vercel/GitHub Pages — primera sección

## What is this  ← 3 líneas máximo

## Quick Start
  git clone ...
  npm install
  npm run dev
  # Abre http://localhost:5173 — funciona en < 10 segundos

## Connect your real MQTT broker  ← gancho técnico clave
  # Config mínima — demuestra que está pensado para producción
  # Nota honesta: funciona con ws:// y wss:// básico.
  # TLS mutuo requiere proxy — ver docs/mqtt-production.md

## Adding your own sensors  ← añade un objeto a RULES[] en RuleEngine.js
  # Ejemplo mínimo de regla nueva con condition()

## SensorConfig — cómo añadir tus propios sensores

## Architecture  ← diagrama del flujo EventBus + SensorState

## Roadmap  ← incluye AI Advisor como V2.0

## Built by [nombre] → [portfolio / LinkedIn]
```

> La sección **"Adding your own sensors"** y **"Connect your real MQTT broker"** son los dos ganchos técnicos. El primero demuestra que el RuleEngine es extensible sin tocar la lógica central. El segundo demuestra que está pensado para producción real.

---

## Fases de construcción

```
FASE 1 — Contratos y data first
  events.js           → catálogo EVENTS + payloads documentados + EVENT_CONTRACT_VERSION ★ PRIMERO
  SensorConfig.js     → define los 10 sensores WTP, rangos y validador dev mode ★
  SensorState.js      → singleton + circular buffer + isReady() + reset() ★
  SensorSceneMap.js   → binding sensor → mesh (contrato previo a ModelFactory) ★
  NoiseGenerator.js   → genera ruido suavizado reutilizable
  sensor.worker.js    → simulación con correlaciones causales + política valores inválidos ★
  EventBus.js         → notificaciones sin acoplamiento (importa de events.js)

FASE 2 — Escena que reacciona a datos
  SceneManager.js     → setup Three.js
  ModelFactory.js     → planta WTP procedural (MeshStandardMaterial en todos los meshes) ★
  AnimationLoop.js    → RAF loop — arranca en paso 2 de init(), después de SceneManager
  ColorMapper.js      → valor → material.color (nunca emissive)
  AlertSystem.js      → overlay vía emissiveIntensity (nunca color) ★
  SceneUpdater.js     → coordina ColorMapper y AlertSystem via SensorSceneMap

FASE 3 — UI
  TelemetryPanel.js   → comprueba isReady(), muestra "—" hasta primer tick ★
  AlertPanel.js       → llama getActiveAlerts() en init() para recuperar estado ★
  Toolbar.js          → controles + estado de conexión MQTT (escucha MQTT_* desde init) ★
  MiniMap.js          → Leaflet

FASE 4 — Adapter + RuleEngine + polish
  RuleEngine.js       → array RULES[] + evaluación + getActiveAlerts() ★
  MQTTAdapter.js      → simulated ↔ real broker + ciclo de vida eventos ★
  DataExporter.js     → JSON/CSV desde SensorState.history (maneja history vacío) ★
  main.js             → init() con orden explícito + error screen + Worker el último ★

FASE 5 — Launch
  README con GIF antes del título
  Demo deploy (Vercel o GitHub Pages — < 10s load)
  GitHub Actions para deploy automático
  Post en HackerNews (Show HN) — lunes o martes mañana

FASE 6 — V2.0 (post-tracción)
  Rama feature/ai-advisor
  ai.worker.js + WebLLM + TinyLlama
  AIPanel.js
```

> ★ `events.js` es el primer archivo que existe. Todos los demás lo importan.
>
> `SensorConfig.js`, `SensorState.js` y `SensorSceneMap.js` siguen inmediatamente — son los contratos del sistema.

---

## Estrategia de distribución

El repo existe. Nadie lo descubre sin esto.

**Día del lanzamiento (Fase 5):**

- **HackerNews Show HN** — lunes o martes por la mañana (hora EU/US East). Título: `Show HN: Browser-only digital twin of a water treatment plant (Three.js + MQTT)`. Potencial: 200–500 stars en 48h si el demo es impresionante.
- **Reddit r/webdev + r/threejs** — mismo día, versión más visual, con GIF.
- **DEV.to** — artículo técnico: "How I built a water treatment digital twin that runs entirely in the browser". Tráfico orgánico a largo plazo.
- **Twitter/X** — GIF del demo funcionando. Sin texto largo. El GIF hace el trabajo.

**Condición necesaria para que funcione: el demo tiene que cargar en menos de 10 segundos.** Sin 700MB de WebLLM, esto es trivialmente alcanzable.

---

## MOSCOW

### MUST HAVE — MVP funcional

- Visor 3D con modelo de planta WTP procedural (meshes con `MeshStandardMaterial`, nombres definidos en `SensorSceneMap.js`)
- 10 sensores simulados en Worker thread con correlaciones causales entre sensores y política de valores inválidos
- `events.js` con catálogo centralizado de todos los nombres de evento y payloads documentados + `EVENT_CONTRACT_VERSION`
- `SensorConfig.js` con validador en dev mode
- `SensorState.js` como singleton con `isReady()`, circular buffer de 360 snapshots, y método `reset()`
- `SensorSceneMap.js` como contrato de binding sensor → 3D con política de IDs desconocidos
- Panel de telemetría con valores en vivo (muestra `—` antes del primer tick)
- `AlertSystem` con overlay vía `emissiveIntensity` (capa separada de `ColorMapper`)
- `ColorMapper` que solo toca `material.color` (nunca `emissive`)
- `RuleEngine` con array `RULES[]` + `condition()` + `getActiveAlerts()` + gestión de ciclo de vida
- `MQTTAdapter` enchufable a broker real (ws/wss, ciclo de vida observable, documentado con límite TLS mutuo)
- Transición Worker ↔ MQTT orquestada por `main.js` con `SensorState.reset()` en el switch
- `AnimationLoop` inicializado en paso 2 de `init()`, después de `SceneManager`
- `Toolbar` y `MiniMap` inicializados en paso 4 de `init()`, antes del Worker
- `AlertPanel` que llama `getActiveAlerts()` en su `init()` para recuperar estado existente
- Estrategia de error visible en `init().catch()` — nunca pantalla en blanco
- Convención `destroy()` implementada en todos los módulos con subscripciones
- `main.js` con `init()` explícito y Worker arrancando el último
- README con GIF antes del título, Quick Start en 3 comandos, y sección de ejemplo de regla personalizada

### SHOULD HAVE — V1.1

- Mapa Leaflet con ubicación de planta municipal
- Histórico de datos con mini gráficas por sensor (usando `SensorState.getHistory()`)
- Export JSON/CSV de series temporales (desde `SensorState.history`, maneja vacío)
- Modo "incidente simulado" — activa escenarios de fallo con un click
- Detección de tendencias en RuleEngine (usando el buffer de histórico)

### COULD HAVE — V2.0

- WebLLM + TinyLlama en rama `feature/ai-advisor`
- Multi-planta en mapa Leaflet (red de distribución)
- Temas visuales (dark ops / light reporting)
- Carga de modelo GLTF propio del usuario

### WON'T HAVE

- Backend propio
- Base de datos
- Autenticación
- WebGPU (prematuro para producción)
- WebLLM en MVP (movido a V2.0 — demasiado peso para el primer "wow")
- TLS mutuo en MQTTAdapter (requiere proxy, fuera del scope del starter kit)

---

## Decisiones tomadas y por qué

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Water Treatment Plant | Fábrica genérica | 0 competidores ligeros, audiencia fiel, sensores comprensibles universalmente |
| WebLLM en V2.0 | WebLLM en MVP | 700MB de descarga + overhead de postMessage destruyen la tasa de conversión del demo |
| RuleEngine determinista | Todo con LLM | Correlaciones de proceso no necesitan IA generativa. Cero latencia, cero peso |
| RuleEngine evalúa snapshots completos | Evalúa lecturas individuales | Correlaciones temporales correctas. Evita false positives entre sensores desincronizados |
| RuleEngine gestiona activeAlerts internamente | Dos eventos separados triggered/resolved | Un solo evento con `active: true/false` simplifica los consumidores — un listener, no dos |
| `getActiveAlerts()` en RuleEngine | Solo eventos | AlertPanel que se reinicia no puede recuperar estado sin este método |
| Contrato de alerta con `id`, `sensorIds`, `active` | Objeto alert sin forma definida | Sin `id` no se puede deduplicar. Sin `sensorIds` no hay feedback visual localizado. Sin `active` no hay resolución |
| Reglas como array de objetos `{ id, condition(), sensorIds, ... }` | Lógica hardcodeada en evaluate() | Un fork añade una regla añadiendo un objeto. No toca la lógica de evaluación |
| `events.js` con payloads documentados + `EVENT_CONTRACT_VERSION` | Strings de eventos sin documentación | Forks saben qué payload esperar en cada evento. La versión hace visible cualquier cambio de contrato |
| `ColorMapper` toca `material.color`, `AlertSystem` toca `emissiveIntensity` | Ambos tocan `material.color` | Capas separadas, sin conflicto. Overlay de alerta no interfiere con color de sensor |
| `MeshStandardMaterial` en todos los meshes | `MeshBasicMaterial` | Requisito para que `AlertSystem` pueda usar `emissive` sin condicionales en cada mesh |
| Correlaciones causales en el simulador | Valores independientes por sensor | Sin correlaciones las reglas de correlación del RuleEngine nunca se disparan en el demo |
| Política valores inválidos: último válido, nunca null | Omitir clave o enviar null | SensorState y RuleEngine no necesitan defensive checks. Primer tick usa midpoint del rango normal |
| `SensorState.isReady()` + estado neutro en UI | Asumir datos disponibles | Los 500ms iniciales no rompen la UI ni generan false positives en RuleEngine |
| `SensorState.reset()` en transición Worker↔MQTT | Mantener histórico entre fuentes | DataExporter no exporta datos mezclados. RuleEngine no tiene alertas huérfanas |
| Transición Worker↔MQTT orquestada por `main.js` | MQTTAdapter pausa el Worker directamente | Worker y MQTTAdapter no se conocen entre sí. main.js es el único orquestador |
| Un tick extra del Worker aceptable en la transición | Pausa síncrona antes de MQTT_CONNECTED | El Worker no puede pausarse instantáneamente. El tick extra es inofensivo — mismo payload, misma forma |
| `AnimationLoop` arranca en paso 2 de `init()` | Arranca dentro de SceneManager o al final | Necesita el renderer (paso 1). El primer frame renderiza la escena vacía sin errores. Los módulos de datos (paso 3+) no necesitan estar listos para el primer frame |
| `Toolbar` y `MiniMap` inicializados en paso 4 | Al final o dentro de sus propios módulos | Toolbar debe escuchar MQTT_* desde el inicio. Orden explícito en init() es la única fuente de verdad |
| Política IDs desconocidos en SceneUpdater: warn en dev, silencio en prod | Error que rompe el bucle | Un sensor desconocido no debe colapsar la actualización de los otros 9 sensores |
| Error screen visible en `init().catch()` | `console.error` solo | Un WebGL no disponible produce pantalla en blanco en el demo público. El error visible es parte del producto |
| `SensorState.js` como singleton | Estado solo en EventBus | EventBus es para notificaciones, no para estado. Evita listeners zombies y reconstitución de estado |
| `SensorSceneMap.js` como contrato | Nombres hardcodeados en SceneUpdater | Única fuente de verdad del binding. Imprescindible antes de escribir ModelFactory |
| Payload único Worker (todos los sensores + timestamp) | Un postMessage por sensor | Un mensaje por tick. Flag `isProcessing` evita acumulación en renders lentos |
| MQTTAdapter documentado con límite TLS mutuo | Prometer "enchufable a producción real" sin aclaración | Los browsers no soportan TLS mutuo en WebSocket. Honestidad previene issues innecesarios |
| Convención `destroy()` en todos los módulos | Sin convención de limpieza | Evita acumulación de listeners zombies cuando se forkea y se añaden módulos |
| Vite | Next.js | Next.js no aporta nada sin servidor. Three.js necesita `window`, en Next requiere `ssr: false` en todo |
| ES Modules + clases JS | Web Components | Shadow DOM añade complejidad sin beneficio. Clases simples son más legibles y forkeables |
| Modelo procedural | GLTF de Sketchfab | Licencias ambiguas. Sin dependencias externas. Más educativo para quien forkea |
| `sensor.worker.js` | Simulador en main thread | Protege el render loop de Three.js de cualquier pico de CPU |
| Leaflet + OSM | Mapbox | Mapbox cuesta a escala. Leaflet es gratis forever |
| `noise(sensorId, amplitude, speed)` como API de NoiseGenerator | API sin sensorId o con estado global | Cada sensor tiene fase independiente. Sin esto todos oscilan en sincronía y se ve artificial |
| Un topic wildcard con JSON completo en MQTTAdapter | Un topic por sensor | Reconstitución de snapshots sincronizados en cliente es compleja e innecesaria. Un mensaje = un snapshot |
| `plantId` configurable en Toolbar (default `plant-01`) | Topic hardcodeado | Varios usuarios del starter kit pueden conectar al mismo broker de demo sin colisiones de topic |
| Payload MQTT idéntico al payload del Worker | Formato distinto para MQTT | `SensorState.update()` recibe el mismo objeto sin condicionales. Cero cambios en el resto del sistema |
| Composición visual especificada (posiciones, dimensiones, cámara, luces) | ModelFactory decide arbitrariamente | Sin especificación, cada corrección visual requiere ajustar coordenadas en cascada. La cámara inicial define la "primera impresión" del demo |

---

## Checklist pre-implementación

Antes de escribir el primer módulo de lógica, verificar que estos contratos están cerrados y documentados:

- [ ] `events.js` creado con todos los nombres de evento + payloads documentados + `EVENT_CONTRACT_VERSION = '1'`
- [ ] Forma del objeto `alert` definida (contrato de salida del RuleEngine — Decisión 6)
- [ ] Flujo de resolución de alertas (`active: false`, un solo evento) — Decisión 7
- [ ] `getActiveAlerts()` implementado en RuleEngine — Decisión 7
- [ ] Estructura de `RULES[]` con `condition()` definida — Decisión 15
- [ ] `SensorState` con `isReady()`, circular buffer, `MAX_HISTORY = 360`, y `reset()` — Decisiones 9 y 12
- [ ] Comportamiento de UI antes del primer tick documentado (`—` en TelemetryPanel, no evaluar en RuleEngine) — Decisión 12
- [ ] Validador de `SensorConfig` en dev mode — Decisión 10
- [ ] 4 estados de ciclo de vida del `MQTTAdapter` en `events.js` con payloads — Decisión 4 + 8
- [ ] Orden de `init()` en `main.js` — AnimationLoop en paso 2, Toolbar/MiniMap en paso 4, Worker siempre el último — Decisión 11
- [ ] Error screen en `init().catch()` — Decisión 11
- [ ] Transición Worker↔MQTT orquestada por `main.js` con `reset()` — Decisión 4
- [ ] Responsabilidad de capas: `ColorMapper` → `material.color`, `AlertSystem` → `emissiveIntensity` — Decisión 13
- [ ] `MeshStandardMaterial` en todos los meshes de `ModelFactory` — Decisión 13
- [ ] Correlaciones causales definidas en `sensor.worker.js` — Decisión 14
- [ ] Política de valores inválidos en el Worker (último válido, midpoint en primer tick) — Decisión 1
- [ ] Política de IDs desconocidos en `SceneUpdater` (warn en dev, silencio en prod) — Decisión 3
- [ ] Nombres de mesh en `SensorSceneMap.js` definidos antes de escribir `ModelFactory.js`
- [ ] API de `NoiseGenerator` definida: `noise(sensorId, amplitude, speed)` + `resetNoise()` — Decisión 16
- [ ] Composición visual de la escena especificada: posiciones de meshes, dimensiones de referencia, posición de cámara, luces — Decisión 17
- [ ] Topic structure de MQTT definido: `wtp/plant/{plantId}/sensors`, payload idéntico al Worker — Decisión 18
- [ ] `plantId` configurable en Toolbar (default `plant-01`) — Decisión 18
- [ ] `docs/mqtt-production.md` con snippet Python para publicar desde instalación real — Decisión 18

---

*Actualizar este documento cada vez que cambie una decisión de arquitectura, se añada un módulo, o se modifique el scope.*