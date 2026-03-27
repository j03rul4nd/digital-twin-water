# DESIGN.md — Water Treatment Digital Twin
### Sistema de diseño, componentes UI y flujo de usuario

> Documento vivo. Leer junto a `PRODUCT.md`.
> Consumir en Fase 2 (escena 3D), Fase 3 (UI), y Fase 4 (adapter + polish).
> Última actualización: pre-implementación.

---

## Para el chat que implemente esto

Este archivo define **qué se ve, cómo se organiza y cómo responde la interfaz** al usuario.
Las decisiones de arquitectura técnica (Workers, EventBus, SensorState, etc.) están en `PRODUCT.md`.
Este archivo no las repite — las asume.

Orden de consumo recomendado:
1. Leer **Design Philosophy** completo antes de escribir ningún CSS
2. Leer **Principios de componentes** antes de tocar ningún módulo de UI
3. Leer **Layout & Panels** antes de tocar `index.html`
4. Leer **Component Specs** antes de implementar cada módulo
5. Leer **User Flow** para entender los momentos del ciclo de vida

---

## Design Philosophy

### Referente conceptual: Functional Brutalism industrial, 2025–2026

El diseño no es decoración del producto — es el producto. La interfaz comunica:
> "Este sistema entiende el proceso, no solo los datos."

El consenso entre estudios de diseño con autoridad en 2025–2026 — Linear, Vercel, Stripe, Raycast, Liveblocks, Basement Studio — y críticos como Paco Cantero, Rauno Fägerholm y Baran Özdemir converge en lo mismo: **"Functional Brutalism"**. Interfaces que no esconden su mecánica. Que usan tipografía como elemento estructural. Que rechazan el glassmorphism de 2022–23 como decoración vacía.

**Este diseño no es ninguno de estos patrones:**
- No es un dashboard de BI (no hay gráficas de barras como elemento principal)
- No es un SCADA legacy (no es gris plano con botones de Windows 95)
- No es glassmorphism (los paneles no son translúcidos con blur excesivo — un `backdrop-filter: blur(8px)` como máximo absoluto)
- No es "dark mode bonito" — el dark es funcional porque los valores de alerta destacan más sobre fondo oscuro, exactamente como lo recomienda el ISA-101 para entornos de control nocturno

### Análisis de mercado: cómo fallan los productos existentes

Los productos industriales de monitorización — Grafana, FUXA, ThingsBoard, OSIsoft PI — tienen el mismo gap documentado en sus propios issues y foros. Conocerlo evita repetir los mismos errores:

**El 3D se abandona a los 30 segundos.** Los usuarios abren la vista 3D por el "wow" inicial y vuelven a los números. El 3D solo retiene atención si tiene feedback visual contextual en tiempo real — si el mesh de Filter 1 se ilumina en rojo cuando el sensor entra en danger, el usuario vuelve a mirar el 3D para entender qué está pasando. Sin eso, es decoración.

**Las alertas se pierden en el ruido.** Cuando hay muchas métricas visibles a la vez, las alertas se diluyen. Los usuarios más productivos en estos sistemas filtran y priorizan alertas por encima de todo. La UI tiene que situar las alertas en el lugar más prominente — no en un tab, no en un modal: siempre visibles.

**La conexión al broker real es la primera fricción de abandono.** El 70% de forks de repos similares mueren en este paso. La UI tiene que hacer esto obvio y dar feedback de estado inmediato. El botón "Connect real MQTT" tiene que estar siempre visible, no enterrado en settings.

**El histórico no se usa si está escondido.** Los gráficos de tendencia son la feature más pedida y la menos visible en los dashboards existentes. La barra de progreso de cada sensor row es el mínimo viable de tendencia visual — ya comunica dónde está el valor dentro de su rango sin necesitar un gráfico completo.

### Tres momentos del usuario — el layout sirve estos tres en orden

La promesa del producto es "en 30 minutos tienes un gemelo digital funcionando de tu planta". El flujo que cumple esa promesa tiene tres momentos:

**Momento 1 (0–5s): el demo carga y ya hay algo vivo.** La escena 3D se mueve, hay valores cambiando. El usuario dice "esto funciona". El layout entrega esto poniendo el 3D como protagonista absoluto — fullscreen, no comprimido en el 70%.

**Momento 2 (5–60s): el usuario entiende qué es cada sensor y qué está pasando.** Ve una alerta. Encuentra el sensor con el valor en rojo. Ve el mesh correspondiente iluminado en la escena. Entiende la correlación sin leer documentación.

**Momento 3 (>60s): el usuario quiere hacer algo.** Abre el README, ve cómo conectar su broker real, o cómo añadir una regla. Los dos CTAs técnicos — "Connect real MQTT →" y "Export CSV" — están siempre accesibles pero nunca en primer plano hasta que el usuario los busca.

---

## Principios de diseño de componentes

Estas reglas se aplican a cada módulo de UI. No son aspiraciones — son restricciones de implementación.

### 1. Color como señal, nunca decoración

Hay exactamente **tres colores semánticos** en todo el sistema: `--green`, `--amber`, `--red`. Se usan exclusivamente para estado de proceso (normal / warning / danger). `--blue` es exclusivo para acciones del usuario (conectar MQTT, exportar).

Esto no es preferencia estética — es el principio central del estándar ISA-101 para interfaces industriales de alto rendimiento: "colors are not decorative — they are signals. Gray and neutral tones represent the normal state." El estándar existe porque el abuso del color en interfaces industriales ha contribuido directamente a incidentes operacionales. Rockwell Automation documenta en su HMI Style Guide: "foreground colors should be minimized. Colors used for alarms and live data should not be used for other objects."

**Regla de implementación:** si un elemento no es un estado de proceso ni una acción del usuario, es neutro. No hay azules para categorías, no hay verdes para decorar headers, no hay colores para diferenciar secciones visualmente. Cuando aparece color en pantalla, el usuario sabe que significa algo.

El corolario: **los meshes 3D en estado normal son grises neutros.** Un mesh con color ya es información — dice que ese sensor está fuera del rango esperado. Un mesh gris dice "todo bien aquí, sigue mirando". Mismo principio ISA-101: "use grayscale as default — color only for abnormal conditions."

### 2. Tipografía mixta como semántica estructural

`font-mono` para valores numéricos en tiempo real. `font-sans` para etiquetas. Esta separación es funcional, no estética.

Rauno Fägerholm, staff design engineer en Vercel y autor de "Invisible Details of Interaction Design", describe esto como diseñar con metáforas que el usuario aprende una vez y aplica en todo el sistema. La monospace en valores numéricos establece una metáfora: "si está en mono, es un dato vivo. Si no lo está, es una etiqueta." El cerebro distingue dato de label sin necesitar color adicional.

Los sistemas SCADA industriales profesionales (Ignition, FactoryTalk View) usan monospace explícitamente en valores numéricos de proceso por esta misma razón: la alineación de columnas que ofrece la monospace permite comparar visualmente valores de la misma magnitud apilados verticalmente — algo imposible con proporcionales.

**Regla de implementación:** ningún valor numérico que venga de `SensorState` usa `font-sans`. Ninguna etiqueta de UI usa `font-mono`. Sin excepciones. El `font-size` de los valores (12px) es deliberadamente mayor que el de las etiquetas (10px) — el dato es lo que el usuario lee primero.

**Nota sobre font choice.** Evitar Inter genérico — es el equivalente al "Arial de los dashboards modernos" y da señal inmediata de AI slop. JetBrains Mono para la mono (mejor legibilidad en tamaños pequeños que Fira Code o Source Code Pro, especialmente en 10–12px). Para la sans, IBM Plex Sans o DM Sans tienen más carácter industrial que Inter sin sacrificar legibilidad.

### 3. Estado siempre visible

El usuario siempre sabe qué está pasando: conexión activa, tick rate, alertas. No hay estados ambiguos.

El dot animado en el topbar no es decorativo — es el indicador de vida del sistema. Si el dot está verde y pulsando, el simulador está corriendo. Si está azul, está conectando a MQTT. Si está rojo, hay un error. El usuario no necesita abrir ningún panel ni hacer hover sobre nada para saber el estado del sistema.

**Regla de implementación:** cualquier cambio de estado del sistema (conexión, error, primer tick, alerta nueva) tiene una representación visual inmediata en el topbar. El topbar es el único lugar donde el estado global es visible en todo momento.

### 4. Transiciones de estado explícitas

Cuando un valor cambia de zona (normal → warning → danger), la UI lo comunica. No solo el resultado final — el cambio.

Rauno Fägerholm en su ensayo "Invisible Details of Interaction Design": "the essence of the word 'interaction' implies a relationship between a human and an environment. Executing well on details makes products feel like a natural extension of ourselves." En un contexto de proceso industrial, esta distinción es criticidad de usabilidad: un operador que no ve el cambio puede perder el momento en que un sensor cruzó un umbral.

**Regla de implementación:** la transición de color de la barra de progreso y el valor numérico de un sensor row usa `transition: color 0.3s ease, background-color 0.3s ease`. No más. Sin bounce, sin spring physics — las transiciones en una interfaz de datos industriales son informativas, no lúdicas. La norma de Rauno sobre esto es explícita: "actions that are frequent and low in novelty should avoid extraneous animations."

### 5. Jerarquía por espaciado, no por bordes

Los límites entre zonas los crea el espaciado. Cuando hay un borde, es porque hay una razón estructural (límite de panel flotante, separación de jerarquía dentro de un componente). No hay bordes decorativos.

Linear documentó esto en su redesign de 2025: "the challenge was preserving that rich density of information without letting the interface feel overwhelming." La solución no fue añadir separadores visuales — fue usar espaciado consistente para crear grupos implícitos.

**Regla de implementación:** dentro de los paneles, los sensor rows se separan con `border-bottom: 1px solid var(--line)` — un borde de separación funcional. Los paneles entre sí se separan solo por el gap de 8px y sus propios bordes de contenedor. No hay dividers adicionales entre secciones del mismo panel.

### 6. Densidad informativa, no cluttering

Un panel denso con buena jerarquía es mejor que un panel espacioso con información oculta. El panel de telemetría muestra 10 sensores a la vez sin scroll en resoluciones típicas de escritorio (1440px+). Esto es información real presentada con jerarquía clara — el referente es el IDE o la terminal, no el landing page corporativo.

**Regla de implementación:** el sensor row tiene 36px de altura. Con header de 36px y padding de 8px top/bottom del body, los 10 sensores + header caben en ~420px. El panel tiene espacio suficiente sin scroll en viewports de 720px+. Si la resolución es menor, el panel hace scroll; no colapsa la información.

### 7. Preattentive processing: los problemas deben ser visibles en 200ms

La investigación en cognición visual establece que el cerebro hace un "sweep preattentivo" de la pantalla en 200–500ms antes de la atención consciente. La ingeniería de HMI industrial tiene un nombre para esto: Situation Awareness. Los estudios del ASM Consortium muestran que las interfaces de alto rendimiento (ISA-101 compliant) ayudan a los operadores a detectar situaciones anómalas más de cinco veces más rápido que las interfaces tradicionales.

En este sistema, hay tres mecanismos para el sweep preattentivo:
1. El chip de alertas en el topbar (posición fija, color saturado cuando activo)
2. El acento de color del alert item en el panel derecho (3px borde izquierdo en `--red` o `--amber`)
3. El glow del mesh 3D (`emissiveIntensity: 0.35`) — visible en visión periférica desde cualquier posición de cámara

**Regla de implementación:** el alert chip en topbar usa `opacity: 0` cuando no hay alertas (no `display: none`) — así puede transicionar suavemente a `opacity: 1` con `transition: opacity 0.15s`. Un elemento que aparece desde `display: none` no tiene transición de entrada.

---

## Tokens de diseño

### Paleta de color

```css
:root {
  /* Fondos — escala de oscuridad */
  --bg:    #0b0c0e;   /* fondo base, viewport 3D */
  --bg1:   #111316;   /* paneles flotantes */
  --bg2:   #16181c;   /* headers de panel */
  --bg3:   #1c1f24;   /* hover states, inputs */

  /* Bordes */
  --line:  #ffffff0f; /* bordes de panel (muy sutil) */
  --line2: #ffffff18; /* bordes de elementos internos */

  /* Texto */
  --text0: #f0f0f0;   /* valores primarios, títulos */
  --text1: #a0a4ad;   /* etiquetas, labels */
  --text2: #52565f;   /* metadata, units, hints */

  /* Semánticos — SOLO para estado de proceso */
  --green:    #22c55e;
  --amber:    #f59e0b;
  --red:      #ef4444;
  --blue:     #3b82f6;

  /* Semánticos con opacidad — para fondos de estado */
  --green-bg: #22c55e12;
  --amber-bg: #f59e0b14;
  --red-bg:   #ef444414;
  --blue-bg:  #3b82f614;
}
```

**Por qué este fondo específico (`#0b0c0e`).** El near-black con leve tinte azulado-gris industrial maximiza el contraste de los colores semánticos sin producir el "void" del negro puro. El negro puro (`#000000`) hace que los textos parezcan flotar sin contexto. Este tono tiene suficiente masa visual para anclar los paneles.

**Por qué tres grises de texto.** `--text0` para valores que el usuario lee activamente (números de sensor, estado de conexión). `--text1` para etiquetas que el usuario escanea pero no lee (nombres de sensor, títulos de panel). `--text2` para metadata que el usuario solo consulta si la busca (unidades, timestamps, hints). Tres niveles de jerarquía sin usar color adicional.

**Regla de oro:** `--green`, `--amber` y `--red` son exclusivamente para estado de proceso. `--blue` es exclusivo para acciones. No se usan para decoración, categorías, ni diferenciación visual arbitraria.

### Tipografía

```css
/* Valores numéricos en tiempo real */
font-family: 'JetBrains Mono', 'Fira Code', monospace;
font-size: 12px;       /* sensor value en panel */
font-size: 10px;       /* metadata, timestamps */
font-weight: 500;      /* énfasis — solo en valores numéricos activos */

/* Etiquetas y UI */
font-family: 'IBM Plex Sans', 'DM Sans', sans-serif;
font-size: 10px;       /* sensor name, panel titles */
font-size: 9px;        /* units, hints, badges */
letter-spacing: 0.08em; /* en títulos de panel en uppercase */
text-transform: uppercase; /* en títulos de panel */
```

### Espaciado y geometría

```css
border-radius: 8px;    /* paneles flotantes */
border-radius: 4px;    /* elementos internos (chips, inputs) */
border-radius: 2px;    /* barras de progreso de sensor */

/* Padding interno de paneles */
padding: 10px 12px;    /* headers de panel */
padding: 7px 12px;     /* sensor rows */
padding: 10px 12px;    /* alert items */
padding: 12px;         /* MQTT panel */
```

**Por qué 8px en paneles flotantes.** Radios más grandes (12px, 16px) hacen los paneles parecer widgets consumer. Radios menores (0–4px) son más brutales pero pierden la sensación de flotación sobre la escena. 8px es el equilibrio para un overlay industrial.

**Por qué 2px en barras de progreso.** Las barras son indicadores de posición dentro de un rango, no elementos de énfasis. Con 2px son visibles sin competir con el valor numérico. Con más altura empiezan a desplazar la atención del número.

---

## Layout & Panels

### Estructura general

```
┌──────────────────────────────────────────────────────┐
│  TOPBAR (40px, fijo)                                 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [LEFT PANEL]   VIEWPORT 3D fullscreen  [RIGHT PANEL]│
│  Telemetría     background: #0b0c0e     Alerts       │
│  (pos: abs)     Three.js renderer       MQTT status  │
│                                         Minimap      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Decisión de layout crítica:** el viewport 3D es `position: absolute; top: 40px; left: 0; right: 0; bottom: 0`. Los paneles flotan sobre él con `position: absolute`. El renderer de Three.js usa `background: transparent` para fundirse con `--bg`. Esto hace que la escena sea el protagonista sin recorte.

Los paneles no tienen `backdrop-filter: blur()` por defecto — el blur añade costo de compositing en GPU que compite con el render loop de Three.js. Si se añade en el futuro, máximo `blur(8px)` y solo en los paneles laterales, nunca en el topbar.

### TOPBAR

- **Altura:** 40px fija, `position: absolute; top: 0; z-index: 10`
- **Fondo:** `--bg1`, `border-bottom: 1px solid var(--line)`
- **Elementos de izquierda a derecha:**

  1. **Dot + nombre:** `.live-dot` + `WTP Digital Twin` — `font-size: 11px; font-weight: 500; color: var(--text0); gap: 8px`
  2. **Separador:** `width: 1px; height: 16px; background: var(--line2); margin: 0 12px`
  3. **Plant ID:** label `Plant` en `--text2` + `<input>` inline (`font-mono; font-size: 11px; background: transparent; border: none; color: --text0; width: 80px`)
  4. **Estado de fuente:** dot de color + texto según estado MQTT
  5. **Separador**
  6. **Tick rate:** `500ms tick` — `font-mono; font-size: 10px; color: --text2`
  7. **`flex: 1`** — espacio vacío
  8. **Alert chip:** `opacity: 0` cuando vacío. Fondo `--red-bg`, borde `1px solid rgba(239,68,68,0.3)`, texto `--red`, `font-size: 10px; padding: 3px 8px; border-radius: 4px; transition: opacity 0.15s`
  9. **Separador**
  10. **Botones ghost:** `Export CSV` y `Docs ↗` — `font-size: 10px; color: --text1; background: transparent; padding: 4px 8px; border: 1px solid var(--line2); border-radius: 4px`

**Comportamiento del alert chip:**
- `activeAlerts.size === 0`: `opacity: 0; pointer-events: none`
- `activeAlerts.size > 0`: `opacity: 1`, muestra `N alerts active`
- Alerts `danger`: borde y texto `--red`
- Solo alerts `warning`: borde y texto `--amber`

**Estados del dot de fuente:**

| Estado | Dot | Texto | Color texto |
|---|---|---|---|
| `Simulator` | `--amber` estático | `Simulator` | `--text1` |
| `mqtt:connecting` | `--blue` parpadeante | `Connecting…` | `--blue` |
| `mqtt:connected` | `--green` estático | `MQTT Connected` | `--text0` |
| `mqtt:error` | `--red` estático | `Error` | `--red` |
| `mqtt:disconnected` | vuelve a `--amber` | `Simulator` | `--text1` |

### LEFT PANEL — Telemetría

- **Posición:** `position: absolute; top: 52px; left: 12px; bottom: 12px; width: 210px`
- **Fondo:** `--bg1; border: 1px solid var(--line); border-radius: 8px; overflow: hidden`
- **Header:** `padding: 10px 12px; background: --bg2; border-bottom: 1px solid var(--line)`
  - Izquierda: `TELEMETRY` — `text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; color: --text1`
  - Derecha: badge `live` — dot `.live-dot` + texto `live` en `font-size: 9px; color: --text2` (gris hasta el primer tick, verde después)
- **Body:** `overflow-y: auto; height: calc(100% - 36px)`

**Sensor Row:**

```
┌────────────────────────────────────────┐
│  inlet_flow                 142.3 m³/h │
│  ████████░░░░░░░░░░░░░░░░░░░░         │
└────────────────────────────────────────┘
```

- `display: grid; grid-template-columns: 1fr auto; align-items: center; padding: 7px 12px; min-height: 36px`
- **Columna izquierda:**
  - Nombre: `font-sans; font-size: 10px; color: var(--text1)`
  - Barra: `height: 2px; border-radius: 1px; margin-top: 4px; background: var(--line2)` con fill `width: {barWidth}%; background: currentColor`
- **Columna derecha:**
  - Valor: `font-mono; font-size: 12px; font-weight: 500; color: {semántico}`
  - Unidad: `font-sans; font-size: 8px; color: var(--text2); margin-left: 2px`
- **Color:** `--green` / `--amber` / `--red` según estado. En `danger`: `background-color: var(--red-bg)` en el row
- **Transiciones:** `transition: color 0.3s ease, background-color 0.3s ease` en valor y barra
- **Separador:** `border-bottom: 1px solid var(--line)` — último row sin borde
- **Hover:** `cursor: pointer; transition: background-color 0.15s` + `hover: background: var(--bg3)`
- **`user-select: none`** en el row completo

**Estado antes del primer tick:**
- Valor: `—` (U+2014)
- Barra: 0% con `var(--line2)`
- Badge `live`: gris, sin animación

**Orden de sensores** (flujo del proceso, no alfabético):
1. `inlet_flow` 2. `raw_turbidity` 3. `coag_ph` 4. `filter_1_dp` 5. `filter_2_dp`
6. `filtered_turbidity` 7. `chlorine_dose` 8. `residual_chlorine` 9. `tank_level` 10. `outlet_pressure`

### RIGHT PANEL — Alertas + MQTT + Minimap

- **Posición:** `position: absolute; top: 52px; right: 12px; bottom: 12px; width: 220px`
- **Layout:** `display: flex; flex-direction: column; gap: 8px`
- Tres sub-paneles independientes con `border: 1px solid var(--line); border-radius: 8px`

**Alert Panel** (`flex: 1; min-height: 0; overflow-y: auto`):

```
┌──────────────────────────────────┐
│ ALERTS               2 active   │
├──────────────────────────────────┤
│▌ filter_1_dp · filtered_turb.   │
│  Filter #1 may be clogged —     │
│  high DP with turbidity...      │
│  14s ago                        │
├──────────────────────────────────┤
│▌ inlet_flow · chlorine_dose     │
│  Chlorine dose not scaling...   │
│  2m ago                         │
└──────────────────────────────────┘
```

- **Header:** igual que panel izquierdo — `ALERTS` + contador `N active` en `--text2`
- **Alert item:** `padding: 10px 12px; border-bottom: 1px solid var(--line); position: relative`
  - **Acento izquierdo:** `position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--red)` (o `--amber`). Este acento es el único color del item
  - **Sensor IDs:** `font-mono; font-size: 9px; color: --text2; margin-bottom: 4px` — `alert.sensorIds.join(' · ')`
  - **Mensaje:** `font-sans; font-size: 10px; color: --text0; line-height: 1.4`
  - **Timestamp:** `font-mono; font-size: 9px; color: --text2; margin-top: 4px` — tiempo relativo (`14s ago`, `2m ago`)
  - **Orden:** `danger` primero, `warning` después. Dentro de cada severidad, por timestamp desc
- **Resolución:** `transition: opacity 0.2s ease` al `active: false`, luego `remove()` a 200ms
- **Estado vacío:** `font-size: 10px; color: --text2; padding: 16px 12px; text-align: center` — `No active alerts`
- **Timestamps relativos:** `setInterval` de 30s actualiza todos los `.alert-time` visibles

**MQTT Panel** (altura fija por contenido):

```
┌──────────────────────────────────┐
│ Source          ● Simulator     │
│ Broker       broker.emqx.io     │
│ Plant ID           plant-01     │
│                                 │
│    [ Connect real MQTT → ]      │
└──────────────────────────────────┘
```

- `padding: 12px`
- **Rows de info:** `display: flex; justify-content: space-between; margin-bottom: 6px`
  - Label: `font-sans; font-size: 10px; color: --text2`
  - Valor: `font-mono; font-size: 10px; color: --text1`
- **Botón CTA:** `width: 100%; background: var(--blue-bg); color: var(--blue); border: 1px solid rgba(59,130,246,0.3); border-radius: 4px; font-size: 10px; padding: 6px 12px; margin-top: 8px`
  - **Este es el único elemento azul del dashboard.** El blue es exclusivo para acciones del usuario
  - Estado `Connecting…`: `cursor: wait; opacity: 0.7`
  - Estado error: texto `Retry →` + `<p style="font-size:9px; color:var(--red)">` con el reason
  - Estado conectado: texto `Disconnect`, fondo `--red-bg`, color `--red`

**Minimap** (altura fija 120px total):

- `height: 120px; display: flex; flex-direction: column; overflow: hidden`
- **Mapa Leaflet:** `flex: 1; min-height: 0` — `zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false`
- **Footer:** `padding: 4px 8px; background: --bg2; border-top: 1px solid var(--line)`
  - Coordenadas: `font-mono; font-size: 9px; color: --text2` — `41.1189, 1.2445`
  - Nombre: `font-sans; font-size: 9px; color: --text2` — `Reus, ES`
- **Marcador:** `L.circleMarker` con `color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, radius: 4, weight: 0`
- **Tiles oscuros:** `.map-tiles-dark { filter: invert(1) hue-rotate(180deg) brightness(0.8) contrast(0.9) }` — convierte el mapa claro en un mapa coherente con el tema oscuro sin tiles propietarios

---

## Component Specs

### `Toolbar.js`

**Responsabilidad:** topbar. Escucha los 4 eventos MQTT y gestiona el alert chip.

**Alert chip:** contador interno. En `EVENTS.RULE_TRIGGERED`:
- `alert.active === true`: incrementa, actualiza texto y color
- `alert.active === false`: decrementa
- Contador a 0: `opacity: 0`

**Destroy:** `EventBus.off` de todos los listeners MQTT y `RULE_TRIGGERED`.

### `TelemetryPanel.js`

**Responsabilidad:** 10 sensor rows. Escucha `EVENTS.SENSOR_UPDATE`.

**Lógica de color:**

```js
function getSensorState(sensorId, value) {
  const config = SensorConfig.find(s => s.id === sensorId);
  if (!config) return 'normal';
  const inDanger  = value < config.danger.low  || value > config.danger.high;
  const inWarning = !inDanger && (value < config.warning.low || value > config.warning.high);
  if (inDanger)  return 'danger';
  if (inWarning) return 'warning';
  return 'normal';
}

const STATE_COLOR = { normal: 'var(--green)', warning: 'var(--amber)', danger: 'var(--red)' };
```

**Ancho de barra:**

```js
function barWidth(sensorId, value) {
  const config = SensorConfig.find(s => s.id === sensorId);
  const { rangeMin, rangeMax } = config;
  return Math.min(100, Math.max(0, ((value - rangeMin) / (rangeMax - rangeMin)) * 100));
}
```

**Actualización del DOM:** no re-renderizar el row completo en cada tick. Actualizar solo los atributos que cambian (`color`, `width`, `background`) con `element.style.setProperty()` directamente.

**Destroy:** `EventBus.off(EVENTS.SENSOR_UPDATE, this._handler)`.

### `AlertPanel.js`

**Responsabilidad:** lista de alertas activas. Escucha `EVENTS.RULE_TRIGGERED`.

**Init:**

```js
init() {
  RuleEngine.getActiveAlerts()
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'danger' ? -1 : 1;
      return b.timestamp - a.timestamp;
    })
    .forEach(alert => this._render(alert));
  this._handler = alert => this._handleAlert(alert);
  EventBus.on(EVENTS.RULE_TRIGGERED, this._handler);
}
```

**Render:** crea `div.alert-item[data-alert-id][data-severity]` con acento, sensor IDs, mensaje y timestamp. Inserta `danger` antes del primer `warning` existente.

**Resolución:**

```js
_handleAlert(alert) {
  if (alert.active) {
    if (!this._root.querySelector(`[data-alert-id="${alert.id}"]`)) this._render(alert);
  } else {
    const el = this._root.querySelector(`[data-alert-id="${alert.id}"]`);
    if (el) { el.style.opacity = '0'; setTimeout(() => { el.remove(); this._updateEmptyState(); }, 200); }
  }
}
```

**Destroy:** `EventBus.off` + `clearInterval` del timer de timestamps.

### `SceneUpdater.js`

**Responsabilidad:** coordina `ColorMapper` y `AlertSystem` sobre los meshes 3D.

**Regla de capas** (de PRODUCT.md Decisión 13):
- `ColorMapper` → `mesh.material.color` únicamente
- `AlertSystem` → `mesh.material.emissiveIntensity` únicamente

```js
// AlertSystem — alert activa
mesh.material.emissive.set(alert.severity === 'danger' ? '#ef4444' : '#f59e0b');
mesh.material.emissiveIntensity = 0.35;

// AlertSystem — alert resuelta
mesh.material.emissiveIntensity = 0.0;
```

**Por qué `0.35` y no más.** Con valores mayores (0.5+) el mesh pierde su color de proceso y se convierte en un blob saturado. Con 0.35 el glow es visible en la escena oscura pero el material mantiene su identidad visual.

### `MiniMap.js`

```js
init() {
  const map = L.map('minimap', {
    zoomControl: false, attributionControl: false,
    scrollWheelZoom: false, dragging: false, doubleClickZoom: false,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    className: 'map-tiles-dark',
  }).addTo(map);
  map.setView([41.1189, 1.2445], 13);
  L.circleMarker([41.1189, 1.2445], {
    radius: 4, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1, weight: 0,
  }).addTo(map);
  this._map = map;
}

destroy() { if (this._map) { this._map.remove(); this._map = null; } }
```

---

## User Flow

### Momento 1: primer contacto (0–5s)

1. Fondo oscuro con la escena 3D ya renderizada (meshes grises neutros)
2. ~500ms después: valores numéricos aparecen en el panel izquierdo
3. Los meshes cambian del gris neutro al color de proceso que `ColorMapper` asigna
4. El badge `live` se activa (dot verde + animación)

**Lo que NO debe pasar:** alertas falsas, `null` visible, barras en rojo sin datos reales.

### Momento 2: exploración (5–60s)

Flujo natural del ojo:
1. Escena 3D — entiende que es una planta de tratamiento
2. Panel derecho — ve alertas activas (chip en topbar + alert items)
3. Panel izquierdo — encuentra `filter_1_dp: 168 mbar` en rojo
4. Vuelve a la escena — ve el mesh de Filter 1 con glow rojo
5. Lee el mensaje de alerta — entiende la correlación entre sensores

### Momento 3: adopción (>60s)

Los dos CTAs técnicos naturales:
1. **`Connect real MQTT →`** — siempre visible en el panel MQTT
2. **`Export CSV`** — en la topbar

**Flujo de conexión MQTT:**
1. Clic en `Connect real MQTT →`
2. Botón → `Connecting…`, `cursor: wait`
3. Se emite `EVENTS.MQTT_CONNECTING` — dot del topbar → azul parpadeante
4. Si éxito: dot verde, `MQTT Connected`, simulador pausado, botón → `Disconnect`
5. Si error: `Retry →` + reason del error en rojo bajo el botón

---

## Estados visuales del sistema

### Normal (sin alertas)
- Topbar: dot verde, `Simulator`, alert chip `opacity: 0`
- Panel izq: todos los valores en `--green`, barras verdes
- Panel der: `No active alerts`
- Escena: meshes con color de proceso, `emissiveIntensity: 0`

### Warning activo
- Topbar: alert chip en `--amber`
- Panel izq: sensor afectado en `--amber`, fondo neutro
- Panel der: alert item acento `--amber`
- Escena: mesh afectado `emissiveIntensity: 0.35` en `--amber`

### Danger activo
- Topbar: alert chip en `--red`
- Panel izq: sensor afectado en `--red`, fondo `--red-bg`
- Panel der: alert item acento `--red`, primero en lista
- Escena: mesh afectado `emissiveIntensity: 0.35` en `--red`

### Conectando MQTT
- Topbar: dot `--blue` parpadeante, texto `Connecting…` en `--blue`
- Panel MQTT: botón `Connecting…`, `cursor: wait; opacity: 0.7`
- Simulador sigue corriendo hasta `MQTT_CONNECTED`

### MQTT conectado
- Topbar: dot `--green`, `MQTT Connected`
- Panel MQTT: botón `Disconnect` con fondo `--red-bg`, texto `--red`

### Sin datos (antes del primer tick)
- Panel izq: todos `—`, barras vacías en `--line2`, badge `live` gris
- Escena: meshes gris neutro (`#666`)
- Panel der: estado vacío
- Duración esperada: ~500ms

---

## CSS global

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'IBM Plex Sans', 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--text0);
  height: 100vh;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbar mínima */
::-webkit-scrollbar { width: 2px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line2); border-radius: 1px; }

/* Live dot */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
.live-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green);
  animation: pulse-dot 2s ease-in-out infinite;
}

/* Transición de alerta al resolverse */
.alert-item { transition: opacity 0.2s ease; }

/* Mapa oscuro */
.map-tiles-dark {
  filter: invert(1) hue-rotate(180deg) brightness(0.8) contrast(0.9);
}

/*
  user-select: none en elementos interactivos frecuentes.
  Principio de Rauno Fägerholm (Web Interface Guidelines):
  "Interactive elements should disable user-select for inner content."
  En rows que se actualizan cada 500ms, evita selecciones accidentales al leer.
*/
.sensor-row, .alert-item, #toolbar { user-select: none; }
```

**Por qué `-webkit-font-smoothing: antialiased`.** En texto pequeño (9–12px) sobre fondo oscuro, el subpixel rendering por defecto hace el texto más grueso y borroso. `antialiased` da un trazo más fino y limpio en pantallas retina — la diferencia es visible especialmente en los valores de 10px.

---

## Qué NO hacer

- **No usar colores semánticos para decoración.** Si algo es azul, es una acción. Si algo es rojo, es un estado de proceso
- **No mostrar `null`, `undefined` o `NaN`.** Siempre `—` hasta que haya dato real
- **No lanzar errores que rompan el render loop.** Un sensor desconocido no colapsa la actualización de los otros 9
- **No añadir animaciones que compitan con el 3D.** Sin parallax, sin partículas de fondo, sin gradientes animados en los paneles
- **No usar `backdrop-filter: blur()` sin medir el frame rate.** Si se añade, máximo `blur(8px)`, solo en paneles, solo si el frame rate se mantiene por encima de 50fps
- **No cambiar el color de los meshes desde `AlertSystem`.** Solo `emissiveIntensity`
- **No re-renderizar un sensor row completo en cada tick.** Actualizar solo los atributos que cambian
- **No usar `display: none` en el alert chip.** Siempre `opacity: 0/1` para transicionar
- **No usar `font-sans` para valores numéricos.** Sin excepciones

---

## Relación con las fases de PRODUCT.md

| Fase | Qué consume de este doc |
|---|---|
| **Fase 2** — Escena 3D | Tokens de color, `MeshStandardMaterial` en todos los meshes, grises neutros por defecto, regla `ColorMapper` vs `AlertSystem`, `emissiveIntensity: 0.35` |
| **Fase 3** — UI | Layout completo, specs de todos los componentes, user flow, CSS global, principios de componentes |
| **Fase 4** — Adapter + polish | Estados MQTT en Toolbar, flujo de conexión, alert chip behavior, filtro oscuro minimap, timestamps relativos en alertas |
| **Fase 5** — Launch | El GIF debe capturar el estado "2 alertas activas" con Filter 1 en rojo — es el estado más visual y comunica el valor del RuleEngine de un vistazo |

---

*Actualizar este documento si cambia el layout, se añade un componente, o se modifica un estado visual. Los cambios de arquitectura técnica van en `PRODUCT.md`.*