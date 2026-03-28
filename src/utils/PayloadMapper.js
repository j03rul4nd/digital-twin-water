/**
 * PayloadMapper.js — Transforma payloads MQTT arbitrarios al formato interno.
 *
 * El sistema espera: { timestamp: number, readings: Record<string, number> }
 *
 * Muchos brokers industriales reales publican formatos distintos:
 *   - Campos planos:  { flow: 142.3, ph: 7.1, ts: 1234567890 }
 *   - Arrays:         { sensors: [{ id: "flow", value: 142.3 }] }
 *   - Anidados:       { data: { process: { inlet_flow: 142.3 } } }
 *   - Sparkplug-like: { metrics: [{ name: "flow", value: 142.3 }] }
 *
 * El mapper usa una configuración de mapeo guardada en localStorage:
 *   wtp_payload_map — JSON con { mode, timestampField, mappings }
 *
 * Modos:
 *   'auto'   — intenta detectar el formato automáticamente (default)
 *   'flat'   — campos planos en la raíz del objeto
 *   'custom' — mapeo explícito de campos definido por el usuario
 *
 * Mapeo custom: array de { from: string, to: string }
 *   from: ruta en el payload origen (dot notation: "data.process.flow")
 *   to:   ID del sensor destino ("inlet_flow")
 */

const STORAGE_KEY = 'wtp_payload_map';

// ─── Config helpers ───────────────────────────────────────────────────────────

export function loadMapConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultConfig();
    return { ...getDefaultConfig(), ...JSON.parse(raw) };
  } catch {
    return getDefaultConfig();
  }
}

export function saveMapConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function getDefaultConfig() {
  return {
    mode:           'auto',   // 'auto' | 'flat' | 'custom'
    timestampField: '',       // vacío = usar Date.now()
    mappings:       [],       // [{ from: string, to: string }]
  };
}

// ─── Acceso a campos anidados ─────────────────────────────────────────────────

/**
 * Lee un valor de un objeto usando dot notation.
 * Ejemplo: get({ data: { flow: 142.3 } }, 'data.flow') → 142.3
 * @param {object} obj
 * @param {string} path — e.g. 'data.process.inlet_flow'
 * @returns {*}
 */
function getByPath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

// ─── PayloadMapper ────────────────────────────────────────────────────────────

const PayloadMapper = {
  /**
   * Transforma un mensaje MQTT crudo al formato interno del sistema.
   * Devuelve null si el mensaje no puede transformarse.
   *
   * @param {string|Buffer} rawMessage — mensaje crudo del broker
   * @returns {{ timestamp: number, readings: Record<string, number> } | null}
   */
  transform(rawMessage) {
    let parsed;
    try {
      parsed = JSON.parse(rawMessage.toString());
    } catch {
      if (import.meta.env.DEV) console.warn('PayloadMapper: JSON inválido', rawMessage);
      return null;
    }

    const config = loadMapConfig();

    // Extraer timestamp
    const timestamp = this._extractTimestamp(parsed, config.timestampField);

    // Extraer readings según el modo
    let readings;
    switch (config.mode) {
      case 'custom':
        readings = this._applyCustomMappings(parsed, config.mappings);
        break;
      case 'flat':
        readings = this._extractFlat(parsed);
        break;
      case 'auto':
      default:
        readings = this._autoDetect(parsed);
        break;
    }

    if (!readings || Object.keys(readings).length === 0) {
      if (import.meta.env.DEV) console.warn('PayloadMapper: no se pudieron extraer readings', parsed);
      return null;
    }

    // Filtrar valores no numéricos
    const cleanReadings = {};
    Object.entries(readings).forEach(([k, v]) => {
      const num = parseFloat(v);
      if (Number.isFinite(num)) cleanReadings[k] = num;
    });

    if (Object.keys(cleanReadings).length === 0) return null;

    return { timestamp, readings: cleanReadings };
  },

  // ─── Extracción de timestamp ─────────────────────────────────────────────────

  _extractTimestamp(parsed, field) {
    if (!field) {
      // Intentar campos comunes
      for (const key of ['timestamp', 'ts', 'time', 'datetime', 't']) {
        const val = parsed[key];
        if (typeof val === 'number' && val > 1_000_000_000) {
          // Normalizar: si parece segundos (< 1e12), convertir a ms
          return val < 1e12 ? val * 1000 : val;
        }
      }
      return Date.now();
    }

    const val = getByPath(parsed, field);
    if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
    return Date.now();
  },

  // ─── Modo auto-detect ────────────────────────────────────────────────────────

  _autoDetect(parsed) {
    // 1. Formato nativo del sistema: { readings: { ... } }
    if (parsed.readings && typeof parsed.readings === 'object') {
      return parsed.readings;
    }

    // 2. Formato Sparkplug-like: { metrics: [{ name, value }] }
    if (Array.isArray(parsed.metrics)) {
      return this._extractFromArray(parsed.metrics, 'name', 'value');
    }

    // 3. Array de sensores: { sensors: [{ id, value }] }
    if (Array.isArray(parsed.sensors)) {
      return this._extractFromArray(parsed.sensors, 'id', 'value');
    }

    // 4. Datos bajo una clave 'data': { data: { flow: 142.3 } }
    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      const readings = this._extractFlat(parsed.data);
      if (Object.keys(readings).length > 0) return readings;
    }

    // 5. Campos planos en la raíz (excluir timestamp y metadatos)
    return this._extractFlat(parsed);
  },

  // ─── Modo flat ───────────────────────────────────────────────────────────────

  _extractFlat(obj) {
    const skip = new Set([
      'timestamp', 'ts', 'time', 't', 'datetime',
      'id', 'plantId', 'plant_id', 'device', 'source',
    ]);
    const readings = {};
    Object.entries(obj).forEach(([k, v]) => {
      if (skip.has(k)) return;
      if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(v))) {
        readings[k] = parseFloat(v);
      }
    });
    return readings;
  },

  // ─── Arrays de métricas ──────────────────────────────────────────────────────

  _extractFromArray(arr, nameKey, valueKey) {
    const readings = {};
    arr.forEach(item => {
      const name  = item[nameKey];
      const value = item[valueKey];
      if (typeof name === 'string' && (typeof value === 'number' || !isNaN(value))) {
        readings[name] = parseFloat(value);
      }
    });
    return readings;
  },

  // ─── Modo custom ─────────────────────────────────────────────────────────────

  _applyCustomMappings(parsed, mappings) {
    if (!Array.isArray(mappings) || mappings.length === 0) {
      // Si no hay mappings custom, volver a auto
      return this._autoDetect(parsed);
    }

    const readings = {};
    mappings.forEach(({ from, to }) => {
      if (!from || !to) return;
      const value = getByPath(parsed, from);
      if (value !== undefined && value !== null) {
        const num = parseFloat(value);
        if (Number.isFinite(num)) readings[to] = num;
      }
    });
    return readings;
  },

  /**
   * Analiza un mensaje de ejemplo y devuelve los campos detectados.
   * Usado por PayloadMapperPanel para ayudar al usuario a configurar el mapeo.
   * @param {string} rawJson
   * @returns {{ fields: string[], suggested: { from: string, to: string }[] } | null}
   */
  analyze(rawJson) {
    let parsed;
    try { parsed = JSON.parse(rawJson); } catch { return null; }

    const fields = this._collectPaths(parsed, '', 3);
    const auto   = this._autoDetect(parsed);
    const suggested = Object.keys(auto).map(k => ({ from: k, to: k }));

    return { fields, suggested, detected: auto };
  },

  /** Recoge todas las rutas dot-notation de un objeto (máx depth) */
  _collectPaths(obj, prefix, maxDepth, depth = 0) {
    if (depth >= maxDepth || typeof obj !== 'object' || obj === null) return [];
    const paths = [];
    Object.entries(obj).forEach(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k;
      paths.push(path);
      if (typeof v === 'object' && !Array.isArray(v)) {
        paths.push(...this._collectPaths(v, path, maxDepth, depth + 1));
      }
    });
    return paths;
  },
};

export default PayloadMapper;