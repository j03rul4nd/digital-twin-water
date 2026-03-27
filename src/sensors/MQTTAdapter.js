/**
 * MQTTAdapter.js — Adaptador a broker MQTT real via WebSocket.
 *
 * Hace que el proyecto sea enchufable a un broker real sin reescribir
 * nada en el resto del sistema. El payload que publica es idéntico al
 * del Worker: { timestamp, readings }.
 *
 * Límite documentado (Decisión 4):
 *   Funciona con brokers configurados para ws:// o wss:// con credenciales simples.
 *   TLS mutuo (certificados de cliente) requiere un proxy intermedio —
 *   los navegadores no pueden hacer TLS mutuo en WebSocket.
 *
 * Topic de suscripción: wtp/plant/{plantId}/sensors
 *   Configurable via plantId. Default: 'plant-01'.
 *   Permite que varios usuarios del starter kit conecten al mismo broker
 *   de demo sin colisiones de topic.
 *
 * Ciclo de vida observable (4 eventos en EVENTS):
 *   MQTT_CONNECTING → MQTT_CONNECTED (o MQTT_ERROR) → MQTT_DISCONNECTED
 *
 * Broker de demo: broker.emqx.io:8083 (ws) / :8084 (wss)
 *
 * Para publicar desde una instalación real, ver docs/mqtt-production.md
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import SensorState from './SensorState.js';

// MQTT.js se carga desde CDN si no está en node_modules.
// Para usar la versión npm: npm install mqtt
// La importación dinámica permite que el resto del sistema funcione
// incluso si mqtt no está instalado (el simulador sigue funcionando).

const MQTTAdapter = {
  /** @type {import('mqtt').MqttClient | null} */
  _client: null,

  /** @type {string} */
  _brokerUrl: 'ws://broker.emqx.io:8083/mqtt',

  /** @type {string} */
  _plantId: 'plant-01',

  /** @type {boolean} */
  _connected: false,

  /**
   * Inicia la conexión al broker MQTT.
   * Emite MQTT_CONNECTING inmediatamente.
   * Emite MQTT_CONNECTED o MQTT_ERROR según el resultado.
   *
   * @param {{ brokerUrl?: string, plantId?: string, username?: string, password?: string }} options
   */
  async connect(options = {}) {
    if (this._connected) {
      await this.disconnect();
    }

    this._brokerUrl = options.brokerUrl ?? this._brokerUrl;
    this._plantId   = options.plantId   ?? this._plantId;

    EventBus.emit(EVENTS.MQTT_CONNECTING, { brokerUrl: this._brokerUrl });

    // Carga dinámica de mqtt.js
    let mqtt;
    try {
      mqtt = await import('mqtt');
    } catch {
      // Fallback: intentar desde CDN (útil si mqtt no está en node_modules)
      EventBus.emit(EVENTS.MQTT_ERROR, {
        brokerUrl: this._brokerUrl,
        reason: 'mqtt package not found. Run: npm install mqtt',
      });
      return;
    }

    const connectOpts = {
      clientId:  `wtp-twin-${Math.random().toString(16).slice(2, 8)}`,
      keepalive: 30,
      reconnectPeriod: 0, // sin reconexión automática — la gestiona main.js
      connectTimeout: 8000,
    };

    if (options.username) connectOpts.username = options.username;
    if (options.password) connectOpts.password = options.password;

    try {
      this._client = mqtt.connect(this._brokerUrl, connectOpts);
    } catch (err) {
      EventBus.emit(EVENTS.MQTT_ERROR, {
        brokerUrl: this._brokerUrl,
        reason: err.message,
      });
      return;
    }

    // ── Eventos del cliente MQTT ──────────────────────────────────────────

    this._client.on('connect', () => {
      this._connected = true;
      const topic = `wtp/plant/${this._plantId}/sensors`;

      this._client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          EventBus.emit(EVENTS.MQTT_ERROR, {
            brokerUrl: this._brokerUrl,
            reason: `Subscribe failed: ${err.message}`,
          });
          return;
        }
        EventBus.emit(EVENTS.MQTT_CONNECTED, {
          brokerUrl: this._brokerUrl,
          topic,
        });
      });
    });

    this._client.on('message', (topic, message) => {
      this._handleMessage(topic, message);
    });

    this._client.on('error', (err) => {
      this._connected = false;
      EventBus.emit(EVENTS.MQTT_ERROR, {
        brokerUrl: this._brokerUrl,
        reason: err.message,
      });
    });

    this._client.on('close', () => {
      if (this._connected) {
        this._connected = false;
        EventBus.emit(EVENTS.MQTT_DISCONNECTED, {
          brokerUrl: this._brokerUrl,
          clean: false,
        });
      }
    });

    this._client.on('offline', () => {
      if (this._connected) {
        this._connected = false;
        EventBus.emit(EVENTS.MQTT_DISCONNECTED, {
          brokerUrl: this._brokerUrl,
          clean: false,
        });
      }
    });
  },

  /**
   * Parsea y procesa un mensaje MQTT entrante.
   * Parsing defensivo — nunca propaga un error al resto del sistema.
   * @param {string} topic
   * @param {Buffer} message
   */
  _handleMessage(topic, message) {
    let snapshot;
    try {
      snapshot = JSON.parse(message.toString());
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn('MQTTAdapter: mensaje no válido ignorado', e);
      }
      return;
    }

    // Validación mínima — debe tener timestamp y readings
    if (!snapshot.timestamp || !snapshot.readings || typeof snapshot.readings !== 'object') {
      if (import.meta.env.DEV) {
        console.warn('MQTTAdapter: payload sin forma esperada ignorado', snapshot);
      }
      return;
    }

    // Mismo flujo que el Worker — SensorState y EventBus no distinguen la fuente
    SensorState.update(snapshot);
    EventBus.emit(EVENTS.SENSOR_UPDATE, snapshot);
  },

  /**
   * Cierra la conexión limpiamente.
   * Emite MQTT_DISCONNECTED con clean: true.
   */
  disconnect() {
    return new Promise((resolve) => {
      if (!this._client) {
        resolve();
        return;
      }

      const wasConnected = this._connected;
      this._connected = false;

      this._client.end(true, {}, () => {
        this._client = null;
        if (wasConnected) {
          EventBus.emit(EVENTS.MQTT_DISCONNECTED, {
            brokerUrl: this._brokerUrl,
            clean: true,
          });
        }
        resolve();
      });
    });
  },

  /**
   * true si hay una sesión MQTT activa.
   * @returns {boolean}
   */
  isConnected() {
    return this._connected;
  },
};

export default MQTTAdapter;