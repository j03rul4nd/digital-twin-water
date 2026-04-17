/**
 * events.js — Catálogo centralizado de todos los eventos del sistema.
 *
 * REGLA: Ningún módulo usa strings literales de eventos.
 * Siempre importar EVENTS desde este archivo.
 *
 * Si se modifica la forma de cualquier payload, subir EVENT_CONTRACT_VERSION.
 * Los forks que dependan del payload pueden hacer un check explícito.
 */

export const EVENT_CONTRACT_VERSION = '5';

export const EVENTS = {
  // ─── Datos de sensores ────────────────────────────────────────────────────
  // Emitido por main.js cada vez que llega un snapshot del Worker o del MQTTAdapter.
  // payload: { timestamp: number, readings: Record<string, number> }
  SENSOR_UPDATE: 'sensor:update',

  // ─── Reglas y alertas ─────────────────────────────────────────────────────
  // Emitido por RuleEngine cuando una regla se activa (active: true)
  // o se resuelve (active: false). Un único evento para ambos casos.
  // payload: {
  //   id: string,
  //   severity: 'warning' | 'danger',
  //   sensorIds: string[],
  //   message: string,
  //   timestamp: number,
  //   active: boolean
  // }
  RULE_TRIGGERED: 'rule:triggered',

  // ─── Ciclo de vida MQTT ───────────────────────────────────────────────────
  // El usuario ha solicitado conexión, proceso en marcha.
  // payload: { brokerUrl: string }
  MQTT_CONNECTING: 'mqtt:connecting',

  // El broker ha confirmado sesión. main.js pausa el Worker al recibir este evento.
  // payload: { brokerUrl: string, topic: string }
  MQTT_CONNECTED: 'mqtt:connected',

  // Fallo de autenticación, red caída, o broker no disponible.
  // main.js reanuda el Worker al recibir este evento.
  // payload: { brokerUrl: string, reason: string }
  MQTT_ERROR: 'mqtt:error',

  // Sesión terminada (cierre limpio o por error).
  // main.js reanuda el Worker al recibir este evento.
  // payload: { brokerUrl: string, clean: boolean }
  MQTT_DISCONNECTED: 'mqtt:disconnected',

  // ─── Exportación ──────────────────────────────────────────────────────────
  // payload: { format: 'json' | 'csv' }
  EXPORT_STARTED: 'export:started',

  // payload: { format: 'json' | 'csv', rowCount: number }
  EXPORT_COMPLETE: 'export:complete',

  // ─── Simulación de incidentes ─────────────────────────────────────────────
  // Emitido por SensorWorker cuando el Worker activa o cancela un escenario.
  // payload: { name: string, expiresAt: number, durationMs: number } | null
  //   null → escenario terminado o cancelado, simulador en modo normal
  SCENARIO_CHANGED: 'scenario:changed',

  // ─── Fuente de datos ──────────────────────────────────────────────────────
  // Emitido por DataSourceManager cuando cambia el modo activo.
  // payload: { mode: 'none' | 'simulation' | 'mqtt' }
  DATA_SOURCE_CHANGED: 'datasource:changed',

  // Emitido por DataSourceManager justo ANTES de limpiar el estado.
  // Los módulos (AlertPanel, KPIEngine, Toolbar…) se suscriben para auto-limpiarse.
  // payload: none
  DATA_SOURCE_CLEARING: 'datasource:clearing',

  // ─── Análisis multi-sensor ─────────────────────────────────────────────────
  // Emitido por cualquier módulo para abrir el panel MultiChartPanel.
  // payload: { sensorIds?: string[] } — si se pasa, el panel pre-carga esos sensores
  OPEN_MULTI_CHART: 'chart:open-multi',

  // ─── Replay Mode ──────────────────────────────────────────────────────────
  // Emitidos por ReplayController para notificar entrada, movimiento y salida
  // del modo replay. Los consumidores (TelemetryPanel, SceneUpdater, AlertPanel,
  // SensorDetailModal, Toolbar) se suscriben para renderizar desde snapshot
  // histórico en vez del estado live.
  //
  // payload: { index: number, snapshot: { timestamp, readings, index, activeAlertIds } }
  REPLAY_ENTERED: 'replay:entered',

  // payload: none
  REPLAY_EXITED: 'replay:exited',

  // payload: { index: number, snapshot: { timestamp, readings, index, activeAlertIds } }
  REPLAY_SCRUBBED: 'replay:scrubbed',

  // ─── Adaptive anomaly detection ───────────────────────────────────────────
  // Emitted by RuleEngine every 5 seconds when ADAPTIVE_RULES_ENABLED is true.
  // purpose: future UI consumers (TelemetryPanel baseline indicators)
  // payload: { baselines: { [sensorId]: { mean: number, std: number, n: number } | null } }
  BASELINE_UPDATED: 'baseline:updated',

  // ─── Report generation ────────────────────────────────────────────────────
  // payload: { template: string, timestamp: number }
  REPORT_GENERATION_STARTED:  'report:generation:started',
  // payload: { pct: number, label: string }
  REPORT_GENERATION_PROGRESS: 'report:generation:progress',
  // payload: { template: string, sizeBytes: number, duration: number }
  REPORT_GENERATION_COMPLETE: 'report:generation:complete',
  // payload: { error: string, template: string }
  REPORT_GENERATION_ERROR:    'report:generation:error',
};