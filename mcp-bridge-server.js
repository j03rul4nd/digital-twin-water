/**
 * mcp-bridge-server.js — Servidor bridge entre el dashboard y el MCP server.
 *
 * Recibe el estado del dashboard via POST y lo escribe en mcp-state.json
 * para que mcp-server.js pueda leerlo.
 *
 * Uso:
 *   node mcp-bridge-server.js
 *
 * Corre en el puerto 3001. El dashboard envía el estado cada 1 segundo.
 * CORS abierto para localhost:5173 (Vite dev server).
 */

import express    from 'express';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'mcp-state.json');
const PORT       = 3001;

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS para el dashboard en localhost
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

app.post('/state', (req, res) => {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ running: true, stateFile: STATE_FILE, port: PORT });
});

app.listen(PORT, () => {
  console.log(`\n🌉 MCP Bridge Server running on port ${PORT}`);
  console.log(`   Writing state to: ${STATE_FILE}`);
  console.log(`   Dashboard should be at: http://localhost:5173\n`);
  console.log(`   Once both are running, configure Claude Desktop:`);
  console.log(`   See docs/claude-desktop-setup.md\n`);
});