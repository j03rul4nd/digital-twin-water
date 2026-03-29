#!/usr/bin/env node
/**
 * mcp-server.js — Servidor MCP para Claude Desktop.
 *
 * Expone el estado del digital twin como tools que Claude puede usar
 * para consultar sensores, alertas, KPIs y operar el sistema.
 *
 * Uso:
 *   node mcp-server.js
 *
 * Configuración en Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "wtp-digital-twin": {
 *       "command": "node",
 *       "args": ["/ruta/completa/al/repo/mcp-server.js"]
 *     }
 *   }
 * }
 *
 * El servidor lee el estado del sistema desde un archivo de estado
 * que el dashboard actualiza cada 500ms (state.json en la raíz).
 *
 * Para que el bridge funcione, arrancar el dashboard con:
 *   npm run dev
 * Y también el bridge de estado:
 *   node mcp-bridge.js
 *
 * Tools expuestas:
 *   get_plant_status     — resumen completo del estado de la planta
 *   get_sensor_readings  — valores actuales de todos los sensores
 *   get_active_alerts    — alertas activas con severidad y mensaje
 *   get_kpis             — métricas de proceso calculadas
 *   get_sensor_trend     — tendencia de un sensor en una ventana de tiempo
 *   get_alert_history    — historial de alertas resueltas recientes
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { createInterface }          from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'mcp-state.json');

// ─── Leer estado del dashboard ────────────────────────────────────────────────

function readState() {
  if (!existsSync(STATE_FILE)) {
    return {
      ready:      false,
      lastUpdate: null,
      readings:   {},
      alerts:     [],
      kpis:       null,
      history:    [],
    };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { ready: false, lastUpdate: null, readings: {}, alerts: [], kpis: null, history: [] };
  }
}

// ─── Tools MCP ────────────────────────────────────────────────────────────────

const TOOLS = {
  get_plant_status: {
    description: 'Get a complete summary of the water treatment plant status including sensor readings, active alerts, and key performance indicators.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler() {
      const state = readState();
      if (!state.ready) {
        return 'The digital twin dashboard is not running or has no data yet. Start the dashboard with `npm run dev` and wait for the simulator to produce data.';
      }

      const alertSummary = state.alerts.length === 0
        ? 'No active alerts.'
        : state.alerts.map(a => `  • [${a.severity.toUpperCase()}] ${a.message} (sensors: ${a.sensorIds.join(', ')})`).join('\n');

      const kpis = state.kpis;
      const kpiSummary = kpis
        ? `Throughput: ${kpis.throughput} m³ | Normal operation: ${kpis.timeNormal}% | Chlorination efficiency: ${kpis.chlorinationEff}% | Alerts fired this session: ${kpis.alertsTriggered}`
        : 'KPIs not yet calculated.';

      const age = state.lastUpdate
        ? Math.floor((Date.now() - state.lastUpdate) / 1000)
        : null;

      return `WATER TREATMENT PLANT STATUS
Last update: ${age !== null ? `${age}s ago` : 'unknown'}

ACTIVE ALERTS (${state.alerts.length}):
${alertSummary}

PERFORMANCE:
${kpiSummary}

SENSOR READINGS:
${Object.entries(state.readings).map(([id, v]) => `  ${id}: ${v}`).join('\n')}`;
    },
  },

  get_sensor_readings: {
    description: 'Get the current real-time values of all sensors in the plant.',
    inputSchema: {
      type: 'object',
      properties: {
        sensor_id: {
          type: 'string',
          description: 'Optional: filter to a specific sensor ID (e.g. "inlet_flow", "filter_1_dp")',
        },
      },
      required: [],
    },
    handler({ sensor_id } = {}) {
      const state = readState();
      if (!state.ready) return 'No sensor data available. Dashboard may not be running.';

      const readings = sensor_id
        ? { [sensor_id]: state.readings[sensor_id] }
        : state.readings;

      if (sensor_id && readings[sensor_id] === undefined) {
        return `Sensor "${sensor_id}" not found. Available sensors: ${Object.keys(state.readings).join(', ')}`;
      }

      return Object.entries(readings)
        .map(([id, value]) => `${id}: ${value ?? 'N/A'}`)
        .join('\n');
    },
  },

  get_active_alerts: {
    description: 'Get all currently active alerts in the plant with severity, affected sensors, and diagnostic message.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['warning', 'danger'],
          description: 'Filter by severity level',
        },
      },
      required: [],
    },
    handler({ severity } = {}) {
      const state = readState();
      let alerts = state.alerts ?? [];

      if (severity) alerts = alerts.filter(a => a.severity === severity);

      if (alerts.length === 0) {
        return severity
          ? `No active ${severity} alerts.`
          : 'No active alerts. Plant operating normally.';
      }

      return alerts.map(a => {
        const age = Math.floor((Date.now() - a.timestamp) / 1000);
        return `[${a.severity.toUpperCase()}] ${a.id}
  Message:  ${a.message}
  Sensors:  ${a.sensorIds.join(', ')}
  Active for: ${age}s`;
      }).join('\n\n');
    },
  },

  get_kpis: {
    description: 'Get process Key Performance Indicators: throughput, operational time distribution, chlorination efficiency, backwash count, and alert statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler() {
      const state = readState();
      const kpis  = state.kpis;

      if (!kpis) return 'KPIs not yet calculated. Wait a few seconds after starting the dashboard.';

      const sessionMin = Math.floor(kpis.sessionDuration / 60);
      const sessionSec = kpis.sessionDuration % 60;

      return `PROCESS KPIs
Session duration:     ${sessionMin}m ${sessionSec}s
Samples in window:    ${kpis.samplesInWindow} (last 3 minutes)

THROUGHPUT
  Estimated volume:   ${kpis.throughput} m³
  Average flow rate:  ${kpis.avgInletFlow} m³/h

OPERATIONAL STATUS
  Normal operation:   ${kpis.timeNormal}%
  In warning:         ${kpis.timeInWarning}%
  In danger:          ${kpis.timeInDanger}%

PROCESS QUALITY
  Chlorination eff.:  ${kpis.chlorinationEff}%
  Chlorine used:      ${kpis.chlorineKg} kg (estimated)
  Backwashes:         ${kpis.backwashCount}

ALERTS
  Triggered this session: ${kpis.alertsTriggered}`;
    },
  },

  get_sensor_trend: {
    description: 'Analyze the trend of a specific sensor over a time window. Returns slope, direction (rising/falling/stable), and statistical summary.',
    inputSchema: {
      type: 'object',
      properties: {
        sensor_id: {
          type: 'string',
          description: 'Sensor ID to analyze (e.g. "filter_1_dp", "tank_level", "inlet_flow")',
        },
        window_seconds: {
          type: 'number',
          description: 'Time window to analyze in seconds (default: 60)',
          default: 60,
        },
      },
      required: ['sensor_id'],
    },
    handler({ sensor_id, window_seconds = 60 } = {}) {
      const state = readState();
      if (!state.ready || !state.history || state.history.length < 2) {
        return 'Not enough history data yet. Wait a few seconds.';
      }

      const now    = Date.now();
      const cutoff = now - window_seconds * 1000;
      const window = state.history
        .filter(s => s.timestamp >= cutoff)
        .map(s => ({ t: s.timestamp, v: s.readings[sensor_id] }))
        .filter(p => typeof p.v === 'number' && isFinite(p.v));

      if (window.length < 2) {
        return `Not enough data for sensor "${sensor_id}" in the last ${window_seconds}s.`;
      }

      const first = window[0].v;
      const last  = window[window.length - 1].v;
      const delta = last - first;
      const values = window.map(p => p.v);
      const mean  = values.reduce((a, b) => a + b, 0) / values.length;
      const min   = Math.min(...values);
      const max   = Math.max(...values);

      // Regresión lineal
      const n = window.length;
      const tBase = window[0].t;
      let sumT = 0, sumV = 0, sumTV = 0, sumTT = 0;
      window.forEach(({ t, v }) => {
        const tn = (t - tBase) / 1000;
        sumT += tn; sumV += v; sumTV += tn * v; sumTT += tn * tn;
      });
      const denom = n * sumTT - sumT * sumT;
      const slope = denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;

      const direction = Math.abs(slope) < 0.05 ? 'stable'
        : slope > 0 ? 'rising' : 'falling';

      return `TREND ANALYSIS: ${sensor_id}
Window: last ${window_seconds}s (${window.length} samples)

Direction:  ${direction.toUpperCase()}
Slope:      ${slope.toFixed(4)} units/second
Delta:      ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} (${first.toFixed(2)} → ${last.toFixed(2)})

Statistics:
  Mean:     ${mean.toFixed(3)}
  Min:      ${min.toFixed(3)}
  Max:      ${max.toFixed(3)}`;
    },
  },

  get_alert_history: {
    description: 'Get the recent history of resolved alerts with duration and resolution time.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of resolved alerts to return (default: 10)',
          default: 10,
        },
      },
      required: [],
    },
    handler({ limit = 10 } = {}) {
      const state = readState();
      const history = (state.alertHistory ?? []).slice(0, limit);

      if (history.length === 0) return 'No resolved alerts in history yet.';

      return history.map(a => {
        const resolvedAgo = Math.floor((Date.now() - a.resolvedAt) / 1000);
        const durationSec = Math.floor((a.resolvedAt - a.timestamp) / 1000);
        return `[${a.severity.toUpperCase()}] ${a.id} — resolved ${resolvedAgo}s ago
  Duration: ${durationSec}s active
  Message:  ${a.message}
  Sensors:  ${a.sensorIds.join(', ')}`;
      }).join('\n\n');
    },
  },
};

// ─── Protocolo MCP (stdio JSON-RPC) ──────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities:    { tools: {} },
        serverInfo:      { name: 'wtp-digital-twin', version: '1.3.0' },
      },
    });
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0', id,
      result: {
        tools: Object.entries(TOOLS).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const tool     = TOOLS[toolName];

    if (!tool) {
      send({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      });
      return;
    }

    try {
      const result = tool.handler(params?.arguments ?? {});
      send({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: String(result) }],
        },
      });
    } catch (err) {
      send({
        jsonrpc: '2.0', id,
        error: { code: -32603, message: err.message },
      });
    }
    return;
  }

  // Notifications (no id) — ignorar silenciosamente
  if (!id) return;

  send({
    jsonrpc: '2.0', id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    handleRequest(req);
  } catch (err) {
    send({
      jsonrpc: '2.0', id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  }
});

process.stderr.write('WTP Digital Twin MCP server running. Waiting for requests...\n');