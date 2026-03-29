/**
 * SparkplugParser.js — Parser de mensajes Sparkplug B.
 *
 * Sparkplug B es el estándar IIoT que usan Ignition, Cirrus Link y PLCs modernos.
 * Usa MQTT con Protobuf como serialización. Topics con estructura:
 *   spBv1.0/{groupId}/DDATA/{edgeNodeId}/{deviceId}
 *
 * Este parser implementa el decode Protobuf mínimo necesario para
 * extraer métricas numéricas sin dependencias externas (sin protobufjs).
 *
 * Implementación: Protobuf binary decode manual para el schema de Sparkplug B.
 * Solo soporta los tipos numéricos (Int32, Int64, Float, Double, Boolean).
 * Suficiente para el 95% de los casos industriales reales.
 *
 * Schema Sparkplug B simplificado:
 *   message Payload {
 *     repeated Metric metrics = 1;
 *     uint64 timestamp = 2;
 *   }
 *   message Metric {
 *     string name  = 1;
 *     uint32 datatype = 3;
 *     oneof value {
 *       uint32 int_value    = 10;
 *       uint64 long_value   = 11;
 *       float  float_value  = 12;
 *       double double_value = 13;
 *       bool   boolean_value = 14;
 *       string string_value = 15;
 *     }
 *   }
 *
 * Tipos Sparkplug B → número:
 *   1  Int8,  2  Int16, 3  Int32, 4  Int64
 *   5  UInt8, 6  UInt16, 7  UInt32, 8  UInt64
 *   9  Float, 10 Double
 *   11 Boolean → 0/1
 */

// ─── Protobuf decoder mínimo ──────────────────────────────────────────────────

const WIRE_VARINT  = 0;
const WIRE_64BIT   = 1;
const WIRE_LENGTH  = 2;
const WIRE_32BIT   = 5;

/**
 * Lee un varint de un Uint8Array a partir de offset.
 * @returns {{ value: number, offset: number }}
 */
function readVarint(buf, offset) {
  let result = 0;
  let shift  = 0;
  while (offset < buf.length) {
    const byte = buf[offset++];
    result |= (byte & 0x7F) << shift;
    shift  += 7;
    if (!(byte & 0x80)) break;
  }
  return { value: result >>> 0, offset };
}

/**
 * Lee un float32 de 4 bytes (little-endian).
 */
function readFloat32(buf, offset) {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return { value: view.getFloat32(0, true), offset: offset + 4 };
}

/**
 * Lee un float64 de 8 bytes (little-endian).
 */
function readFloat64(buf, offset) {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  return { value: view.getFloat64(0, true), offset: offset + 8 };
}

/**
 * Lee una string UTF-8 de longitud `len`.
 */
function readString(buf, offset, len) {
  const bytes = buf.slice(offset, offset + len);
  return { value: new TextDecoder().decode(bytes), offset: offset + len };
}

/**
 * Parsea un mensaje Protobuf genérico y devuelve un mapa de campo → valor.
 * Solo soporta los wire types necesarios para Sparkplug B.
 * @param {Uint8Array} buf
 * @returns {Map<number, any[]>} fieldNumber → array de valores
 */
function parseProto(buf) {
  const fields = new Map();
  let offset   = 0;

  while (offset < buf.length) {
    const tagResult  = readVarint(buf, offset);
    offset           = tagResult.offset;
    const tag        = tagResult.value;
    const fieldNum   = tag >>> 3;
    const wireType   = tag & 0x7;

    if (!fields.has(fieldNum)) fields.set(fieldNum, []);

    if (wireType === WIRE_VARINT) {
      const r = readVarint(buf, offset);
      offset  = r.offset;
      fields.get(fieldNum).push(r.value);
    } else if (wireType === WIRE_64BIT) {
      const r = readFloat64(buf, offset);
      offset  = r.offset;
      fields.get(fieldNum).push(r.value);
    } else if (wireType === WIRE_LENGTH) {
      const lenResult = readVarint(buf, offset);
      offset = lenResult.offset;
      const len = lenResult.value;
      const bytes = buf.slice(offset, offset + len);
      fields.get(fieldNum).push(bytes);
      offset += len;
    } else if (wireType === WIRE_32BIT) {
      const r = readFloat32(buf, offset);
      offset  = r.offset;
      fields.get(fieldNum).push(r.value);
    } else {
      // Wire type desconocido — no podemos continuar
      break;
    }
  }

  return fields;
}

// ─── SparkplugParser ──────────────────────────────────────────────────────────

const SparkplugParser = {
  /**
   * Determina si un topic es de tipo Sparkplug B DDATA o DBIRTH.
   * @param {string} topic
   * @returns {boolean}
   */
  isSparkplugTopic(topic) {
    return /^spBv1\.0\/.+\/(DDATA|DBIRTH|NDATA|NBIRTH)\/.+/.test(topic);
  },

  /**
   * Parsea un payload binario Sparkplug B.
   * @param {Buffer|Uint8Array} rawBuffer
   * @returns {{ timestamp: number, readings: Record<string, number> } | null}
   */
  parse(rawBuffer) {
    try {
      const buf = rawBuffer instanceof Uint8Array
        ? rawBuffer
        : new Uint8Array(rawBuffer);

      const payload = parseProto(buf);

      // field 2 = timestamp (uint64 varint)
      let timestamp = Date.now();
      if (payload.has(2) && payload.get(2).length > 0) {
        timestamp = payload.get(2)[0];
        // Normalizar: si parece segundos, convertir a ms
        if (timestamp < 1e12) timestamp *= 1000;
      }

      // field 1 = repeated Metric (length-delimited)
      const readings = {};
      if (payload.has(1)) {
        payload.get(1).forEach(metricBytes => {
          if (!(metricBytes instanceof Uint8Array)) return;
          const metric = parseProto(metricBytes);

          // field 1 = name (string)
          let name = null;
          if (metric.has(1) && metric.get(1)[0] instanceof Uint8Array) {
            name = new TextDecoder().decode(metric.get(1)[0]);
          }
          if (!name) return;

          // Limpiar el nombre: quitar prefijos como "WTP/", espacios, etc.
          const cleanName = name.replace(/^.*\//, '').replace(/\s+/g, '_').toLowerCase();

          // Extraer valor numérico según wire type disponible
          // field 10 = int_value (uint32 varint)
          // field 11 = long_value (uint64 varint)
          // field 12 = float_value (float32 wire 5)
          // field 13 = double_value (float64 wire 1)
          // field 14 = boolean_value (varint 0/1)
          let value = null;

          if (metric.has(10)) value = metric.get(10)[0];
          else if (metric.has(11)) value = metric.get(11)[0];
          else if (metric.has(12)) value = metric.get(12)[0];
          else if (metric.has(13)) value = metric.get(13)[0];
          else if (metric.has(14)) value = metric.get(14)[0] ? 1 : 0;

          if (value !== null && Number.isFinite(value)) {
            readings[cleanName] = parseFloat(value.toFixed(4));
          }
        });
      }

      if (Object.keys(readings).length === 0) return null;

      return { timestamp, readings };

    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('SparkplugParser: error parseando payload', err);
      }
      return null;
    }
  },
};

export default SparkplugParser;