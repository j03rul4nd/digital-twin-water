# Claude Desktop Integration

Connect Claude Desktop to your WTP Digital Twin so Claude can query sensor data, analyze alerts, inspect process KPIs, and generate PDF reports in real time.

---

## How it works

```
Dashboard (browser)
  → MCPBridge (every 1s)
  → mcp-bridge-server.js (writes mcp-state.json)
  → mcp-server.js reads mcp-state.json
  → Claude Desktop calls tools via MCP protocol
```

---

## Setup

### 1. Install dependencies

```bash
cd digital-twin-water
npm install   # already done if you ran this before
```

### 2. Start the dashboard

```bash
npm run dev
# Open http://localhost:5173
```

### 3. Start the bridge server (new terminal)

```bash
node mcp-bridge-server.js
# MCP Bridge Server running on port 3001
```

### 4. Configure Claude Desktop

Find your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the MCP server:

```json
{
  "mcpServers": {
    "wtp-digital-twin": {
      "command": "node",
      "args": ["/absolute/path/to/digital-twin-water/mcp-server.js"]
    }
  }
}
```

Replace `/absolute/path/to/digital-twin-water/` with the actual path to your repo.

### 5. Restart Claude Desktop

After saving the config, restart Claude Desktop. You should see "wtp-digital-twin" in the MCP connections list.

---

## Available tools

Once connected, Claude can use these tools:

| Tool | What it does |
|---|---|
| `get_plant_status` | Full plant summary — readings, alerts, KPIs |
| `get_sensor_readings` | Current values of all (or one specific) sensor |
| `get_active_alerts` | Active alerts with severity and diagnostic message |
| `get_kpis` | Process KPIs: throughput, chlorination efficiency, etc. |
| `get_sensor_trend` | Trend analysis of a sensor over a time window |
| `get_alert_history` | Recent resolved alerts with duration |
| `generate_plant_report` | *(roadmap)* Generate a PDF report snapshot — returns the full data payload that `ReportEngine.getReportDataSnapshot()` produces, ready to pipe into jsPDF server-side |

> **Note on `generate_plant_report`:** The browser-side PDF engine (`ReportEngine.generateReport()`) already supports `onlyData: true` to return the plain JSON snapshot without generating a PDF. The MCP tool will call this endpoint and return the structured data. Full PDF binary generation via MCP requires a Node.js jsPDF invocation server-side — this is planned for V2.

---

## Example prompts

Once configured, try these in Claude Desktop:

```
What's the current status of the water treatment plant?
```

```
Are there any active danger alerts? What's causing them?
```

```
What's the trend for filter_1_dp over the last 2 minutes?
Is it heading towards clogging?
```

```
How efficient has the chlorination been in this session?
What's the estimated water throughput?
```

```
Summarize what happened with the plant in the last 3 minutes.
Any anomalies worth investigating?
```

```
Give me a shift handover summary I could read to the incoming operator.
```

```
There was an incident with the chlorine levels 10 minutes ago.
What sensors were involved and what was the timeline?
```

---

## Troubleshooting

**Claude Desktop doesn't show the wtp-digital-twin server**
- Check the path in `claude_desktop_config.json` is absolute and correct
- Verify `node mcp-server.js` runs without errors from the repo root
- Restart Claude Desktop after any config change

**Tools return "Dashboard not running"**
- Make sure `npm run dev` is running at `http://localhost:5173`
- Make sure `node mcp-bridge-server.js` is running on port 3001
- Wait 2-3 seconds after starting both for the first state write

**Bridge server CORS error**
- The bridge only accepts connections from `localhost:5173`
- If you changed Vite's port, update the CORS origin in `mcp-bridge-server.js`

---

## Event contract compatibility

The dashboard exports `EVENT_CONTRACT_VERSION` from `src/core/events.js`. If you have a fork or custom MCP server that checks this value, note the version history:

| Version | What changed |
|---|---|
| `'4'` | Replay mode events, baseline anomaly detection |
| `'5'` | Report generation events (`report:generation:*`) added |

Forks checking the contract version should update their guard from `'4'` to `'5'`:

```js
import { EVENT_CONTRACT_VERSION } from './src/core/events.js';
if (EVENT_CONTRACT_VERSION !== '5') console.warn('Unexpected contract version');
```