/**
 * main.js — Entry point. Orquesta el arranque en orden explícito.
 *
 * Orden de inicialización (Decisión 11, revisado):
 *   1. SceneManager + ModelFactory  — el renderer tiene que existir antes de cualquier mesh
 *   2. AnimationLoop                — arranca después de la escena, antes de datos
 *                                     (el primer frame renderiza la escena vacía sin errores)
 *   3. SensorState + RuleEngine + DataSourceManager — listos para recibir datos
 *   4. UI + SceneUpdater + AlertSystem — subscripciones al EventBus registradas antes del primer tick
 *                                       Toolbar y MiniMap aquí aunque no consuman datos de sensor:
 *                                       Toolbar necesita escuchar MQTT_* y DATA_SOURCE_CHANGED desde el inicio.
 *   5. StartupModal — el usuario elige fuente de datos explícitamente
 *      (SensorWorker NUNCA arranca automáticamente — siempre por acción del usuario)
 *
 * REGLA: cualquier módulo nuevo debe inicializarse en el paso 4,
 * antes de StartupModal.show(). Esta función es el único punto de entrada.
 *
 * GARANTÍAS post-refactor:
 *   - La simulación NUNCA se activa sin acción explícita del usuario.
 *   - MQTT_DISCONNECTED / MQTT_ERROR NO reanudan la simulación.
 *   - Al cambiar de fuente, TODO el estado previo se limpia (readings, histórico,
 *     alertas activas, historial de alertas, KPIs, contadores de Toolbar).
 *
 * Estrategia de error visible en init().catch():
 *   Un WebGL no disponible o un import fallido produce pantalla en blanco.
 *   El error screen es parte del producto — el usuario sabe qué pasó.
 */

import SceneManager    from './core/SceneManager.js';
import ModelFactory    from './core/ModelFactory.js';
import AnimationLoop   from './core/AnimationLoop.js';
import EventBus        from './core/EventBus.js';
import { EVENTS }      from './core/events.js';

import SensorState     from './sensors/SensorState.js';
import RuleEngine      from './sensors/RuleEngine.js';

import SceneUpdater    from './scene/SceneUpdater.js';
import AlertSystem     from './scene/AlertSystem.js';

import TelemetryPanel  from './ui/TelemetryPanel.js';
import AlertPanel      from './ui/AlertPanel.js';
import Toolbar         from './ui/Toolbar.js';
import MiniMap         from './ui/MiniMap.js';
import MQTTPanel       from './ui/MQTTPanel.js';

import DataExporter    from './utils/DataExporter.js';
import ConfigModal     from './ui/ConfigModal.js';
import SensorDetailModal from './ui/SensorDetailModal.js';
import IncidentPanel    from './ui/IncidentPanel.js';
import WebhookPanel     from './ui/WebhookPanel.js';
import PayloadMapperPanel from './ui/PayloadMapperPanel.js';
import WebhookManager   from './utils/WebhookManager.js';
import KPIEngine        from './sensors/KPIEngine.js';
import KPIPanel         from './ui/KPIPanel.js';
import MCPBridge        from './utils/MCPBridge.js';
import DataSourceManager from './core/DataSourceManager.js';
import StartupModal     from './ui/StartupModal.js';

import MobileTabBar    from './ui/MobileTabBar.js';
import MultiChartPanel from './ui/MultiChartPanel.js';
import EventMarkers    from './charts/EventMarkers.js';

import ReplayController from './core/ReplayController.js';
import ReplayBar       from './ui/ReplayBar.js';


// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {

  // ── Paso 1: Escena ─────────────────────────────────────────────────────────
  // El renderer tiene que existir antes de cualquier mesh.
  await SceneManager.init();
  ModelFactory.build(); // nombres de mesh según SensorSceneMap — síncrono

  // ── Paso 2: AnimationLoop ──────────────────────────────────────────────────
  // Arranca después de que la escena exista, antes de que lleguen datos.
  // El primer frame renderiza la escena vacía (meshes grises neutros) sin errores.
  AnimationLoop.start();

  // ── Paso 3: Estado y lógica ────────────────────────────────────────────────
  // Listos para recibir datos antes de que llegue el primer tick.
  SensorState.reset(); // garantiza estado limpio al arrancar
  RuleEngine.init();
  KPIEngine.init();
  DataSourceManager.init(); // máquina de estados para la fuente de datos

  // ── Paso 4: UI ────────────────────────────────────────────────────────────
  // Subscripciones al EventBus registradas antes del primer tick.
  // Toolbar y MiniMap se inicializan aquí aunque no consuman datos de sensor:
  // Toolbar necesita escuchar MQTT_* desde el inicio.
  TelemetryPanel.init();
  AlertPanel.init();
  SceneUpdater.init();
  AlertSystem.init();
  Toolbar.init();
  MQTTPanel.init();
  MiniMap.init();
  MobileTabBar.init();
  DataExporter.init();
  ConfigModal.init();
  SensorDetailModal.init();
  IncidentPanel.init();
  WebhookManager.init();
  WebhookPanel.init();
  PayloadMapperPanel.init();
  KPIPanel.init();
  MCPBridge.init();
  MultiChartPanel.init();
  EventMarkers.init();

  // Replay mode: controller primero (modelo) y luego la bar (vista).
  // El controller escucha DATA_SOURCE_CLEARING para auto-exit; la bar
  // se suscribe al controller y también escucha los eventos REPLAY_*.
  ReplayController.init();
  ReplayBar.init();

  // AlertPanel puede recuperar alertas activas ahora que RuleEngine existe.
  // Al arrancar no hay alertas (SensorState.reset() fue llamado en paso 3),
  // pero el bloque se mantiene para coherencia con el contrato de AlertPanel.
  RuleEngine.getActiveAlerts()
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'danger' ? -1 : 1;
      return b.timestamp - a.timestamp;
    })
    .forEach(alert => AlertPanel._renderAlert?.(alert));

  // ── Paso 5: StartupModal — el usuario elige la fuente de datos ─────────────
  // SensorWorker NUNCA arranca automáticamente.
  // DataSourceManager gestiona todas las transiciones Worker ↔ MQTT.
  // La lógica de orquestación ya está en DataSourceManager.init() (paso 3).
  await StartupModal.show();
}

// ─── Error screen visible ─────────────────────────────────────────────────────
// Un WebGL no disponible o un import fallido produce pantalla en blanco.
// Este handler garantiza que el usuario ve qué pasó — nunca pantalla en blanco.

init().catch(err => {
  console.error('Init failed:', err);

  const root = document.getElementById('app') ?? document.body;
  root.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: 'JetBrains Mono', monospace;
      color: #ef4444;
      background: #0b0c0e;
      gap: 12px;
      padding: 24px;
      text-align: center;
    ">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <h2 style="font-size: 14px; font-weight: 500; color: #f0f0f0; margin: 0;">
        Failed to initialize
      </h2>
      <p style="font-size: 12px; color: #ef4444; margin: 0; max-width: 400px;">
        ${err.message}
      </p>
      <p style="font-size: 11px; color: #52565f; margin: 0;">
        WebGL may not be available in this browser, or a module failed to load.
        Check the console for details.
      </p>
    </div>
  `;
});