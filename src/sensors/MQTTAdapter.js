/**
 * MQTTAdapter.js — Adaptador a broker MQTT real via WebSocket.
 *
 * Fix aplicado: Vite bundlea mqtt como CJS wrapped en ESM, lo que hace que
 * el módulo llegue como { default: { connect, ... } } en vez de { connect, ... }.
 * La línea `mqttLib = mod.default ?? mod` normaliza ambos casos.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import SensorState from './SensorState.js';

const MQTTAdapter = {
  _client:    null,
  _brokerUrl: 'wss://9da7cd10c3c440aa9e8c2ac30e5a733b.s2.eu.hivemq.cloud:8884/mqtt',
  _plantId:   'plant-01',
  _connected: false,

  /**
   * Inicia la conexión al broker MQTT.
   * @param {{ brokerUrl?: string, plantId?: string, username?: string, password?: string }} options
   */
  async connect(options = {}) {
    if (this._connected) {
      await this.disconnect();
    }

    this._brokerUrl = options.brokerUrl ?? this._brokerUrl;
    this._plantId   = options.plantId   ?? this._plantId;

    EventBus.emit(EVENTS.MQTT_CONNECTING, { brokerUrl: this._brokerUrl });

    // ── Import dinámico de mqtt.js ────────────────────────────────────────
    // Vite puede entregar el módulo de dos formas según cómo resuelva CJS/ESM:
    //   a) { connect: fn, ... }           — ESM nativo
    //   b) { default: { connect: fn } }   — CJS wrapped por Vite
    // `mod.default ?? mod` normaliza ambos casos.
    let mqttLib;
    try {
      const mod = await import('mqtt');
      mqttLib = mod.default ?? mod;
    } catch {
      EventBus.emit(EVENTS.MQTT_ERROR, {
        brokerUrl: this._brokerUrl,
        reason: 'mqtt package not found — run: npm install mqtt',
      });
      return;
    }

    if (typeof mqttLib.connect !== 'function') {
      EventBus.emit(EVENTS.MQTT_ERROR, {
        brokerUrl: this._brokerUrl,
        reason: 'mqtt.connect is not a function — run: npm install mqtt@5',
      });
      return;
    }

    // ── Opciones de conexión ──────────────────────────────────────────────
    const connectOpts = {
      clientId:        `wtp-twin-${Math.random().toString(16).slice(2, 8)}`,
      keepalive:       30,
      reconnectPeriod: 0,       // sin reconexión automática
      connectTimeout:  8000,
    };

    if (options.username) connectOpts.username = options.username;
    if (options.password) connectOpts.password = options.password;

    // ── Conectar ──────────────────────────────────────────────────────────
    try {
      this._client = mqttLib.connect(this._brokerUrl, connectOpts);
    } catch (err) {
      EventBus.emit(EVENTS.MQTT_ERROR, {
        brokerUrl: this._brokerUrl,
        reason: err.message,
      });
      return;
    }

    // ── Eventos del cliente ───────────────────────────────────────────────
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
        EventBus.emit(EVENTS.MQTT_CONNECTED, { brokerUrl: this._brokerUrl, topic });
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
        EventBus.emit(EVENTS.MQTT_DISCONNECTED, { brokerUrl: this._brokerUrl, clean: false });
      }
    });

    this._client.on('offline', () => {
      if (this._connected) {
        this._connected = false;
        EventBus.emit(EVENTS.MQTT_DISCONNECTED, { brokerUrl: this._brokerUrl, clean: false });
      }
    });
  },

  /**
   * Parsea y procesa un mensaje MQTT entrante.
   * Parsing defensivo — nunca propaga errores al resto del sistema.
   */
  _handleMessage(topic, message) {
    let snapshot;
    try {
      snapshot = JSON.parse(message.toString());
    } catch (e) {
      if (import.meta.env.DEV) console.warn('MQTTAdapter: mensaje no válido ignorado', e);
      return;
    }

    if (!snapshot.timestamp || !snapshot.readings || typeof snapshot.readings !== 'object') {
      if (import.meta.env.DEV) console.warn('MQTTAdapter: payload sin forma esperada', snapshot);
      return;
    }

    SensorState.update(snapshot);
    EventBus.emit(EVENTS.SENSOR_UPDATE, snapshot);
  },

  /**
   * Cierra la conexión limpiamente.
   */
  disconnect() {
    return new Promise((resolve) => {
      if (!this._client) { resolve(); return; }

      const wasConnected = this._connected;
      this._connected = false;

      this._client.end(true, {}, () => {
        this._client = null;
        if (wasConnected) {
          EventBus.emit(EVENTS.MQTT_DISCONNECTED, { brokerUrl: this._brokerUrl, clean: true });
        }
        resolve();
      });
    });
  },

  isConnected() {
    return this._connected;
  },
};

export default MQTTAdapter;