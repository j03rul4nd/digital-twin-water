/**
 * MCPBridge.js — Bridge entre el dashboard y el MCP server.
 *
 * El MCP server es un proceso Node.js separado que no puede acceder
 * al estado del browser directamente. Este módulo envía el estado
 * actual a un endpoint local que lo escribe en mcp-state.json.
 *
 * Flujo:
 *   Dashboard (browser) → MCPBridge → POST http://localhost:3001/state
 *                                    → mcp-bridge-server.js escribe mcp-state.json
 *                                    → mcp-server.js lee mcp-state.json
 *
 * Para activar el bridge:
 *   node mcp-bridge-server.js   (en una terminal separada)
 *
 * Si el bridge server no está corriendo, MCPBridge falla silenciosamente
 * — el dashboard sigue funcionando normalmente.
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import SensorState from '../sensors/SensorState.js';
import RuleEngine  from '../sensors/RuleEngine.js';
import KPIEngine   from '../sensors/KPIEngine.js';

const BRIDGE_URL     = 'http://localhost:3001/state';
const PUSH_INTERVAL  = 1000; // ms — enviar estado al bridge cada 1s

const MCPBridge = {
  _timer:        null,
  _latestKpis:   null,
  _alertHistory: [], // últimas alertas resueltas
  _kpiHandler:   null,
  _alertHandler: null,

  init() {
    // Capturar KPIs cuando se calculan
    this._kpiHandler = (kpis) => { this._latestKpis = kpis; };
    EventBus.on(EVENTS.KPIS_UPDATED, this._kpiHandler);

    // Capturar historial de alertas resueltas
    this._alertHandler = (alert) => {
      if (!alert.active) {
        this._alertHistory.unshift({
          ...alert,
          resolvedAt: Date.now(),
        });
        if (this._alertHistory.length > 20) this._alertHistory.pop();
      }
    };
    EventBus.on(EVENTS.RULE_TRIGGERED, this._alertHandler);

    // Push periódico del estado
    this._timer = setInterval(() => this._push(), PUSH_INTERVAL);
  },

  async _push() {
    if (!SensorState.isReady()) return;

    const state = {
      ready:        true,
      lastUpdate:   Date.now(),
      readings:     { ...SensorState.readings },
      alerts:       RuleEngine.getActiveAlerts(),
      kpis:         this._latestKpis,
      history:      SensorState.history.slice(-120), // últimos 60s
      alertHistory: this._alertHistory,
    };

    try {
      await fetch(BRIDGE_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(state),
      });
    } catch {
      // Bridge server no está corriendo — silencioso
    }
  },

  destroy() {
    if (this._timer)        { clearInterval(this._timer); this._timer = null; }
    if (this._kpiHandler)   { EventBus.off(EVENTS.KPIS_UPDATED,   this._kpiHandler);   }
    if (this._alertHandler) { EventBus.off(EVENTS.RULE_TRIGGERED, this._alertHandler); }
  },
};

export default MCPBridge;