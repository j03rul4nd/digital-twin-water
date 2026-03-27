/**
 * DataExporter.js — Exporta el histórico de SensorState a CSV o JSON.
 *
 * Escucha EVENTS.EXPORT_STARTED (emitido por Toolbar al pulsar "Export CSV").
 * Descarga el archivo directamente en el navegador via URL.createObjectURL.
 *
 * Maneja el caso de history vacío: devuelve un archivo válido con 0 filas
 * y un comentario explicativo — nunca falla silenciosamente.
 *
 * Emite EVENTS.EXPORT_COMPLETE con el número de filas exportadas.
 */

import EventBus from '../core/EventBus.js';
import { EVENTS } from '../core/events.js';
import SensorState from '../sensors/SensorState.js';
import { SENSORS } from '../sensors/SensorConfig.js';

const DataExporter = {
  /** @type {Function | null} */
  _handler: null,

  /**
   * Registra el listener de EXPORT_STARTED.
   * Llamar en el paso 4 de init() en main.js.
   */
  init() {
    this._handler = ({ format }) => {
      if (format === 'csv') {
        this.exportCSV();
      } else if (format === 'json') {
        this.exportJSON();
      }
    };
    EventBus.on(EVENTS.EXPORT_STARTED, this._handler);
  },

  /**
   * Exporta el histórico como CSV.
   * Columnas: timestamp, sensor_id_1, sensor_id_2, ...
   * Una fila por snapshot.
   */
  exportCSV() {
    const history = SensorState.history;
    const sensorIds = SENSORS.map(s => s.id);

    // Header
    const header = ['timestamp', ...sensorIds].join(',');

    let rows;
    if (history.length === 0) {
      // History vacío — archivo válido con comentario
      rows = ['# No data recorded yet — start the simulator and wait for data'];
    } else {
      rows = history.map(snapshot => {
        const values = sensorIds.map(id => {
          const v = snapshot.readings[id];
          return v !== undefined ? v : '';
        });
        return [snapshot.timestamp, ...values].join(',');
      });
    }

    const content = [header, ...rows].join('\n');
    const filename = `wtp-export-${this._timestamp()}.csv`;

    this._download(content, filename, 'text/csv;charset=utf-8;');

    EventBus.emit(EVENTS.EXPORT_COMPLETE, {
      format: 'csv',
      rowCount: history.length,
    });
  },

  /**
   * Exporta el histórico como JSON.
   * Array de snapshots: [{ timestamp, readings: { ... } }, ...]
   */
  exportJSON() {
    const history = SensorState.history;

    const payload = {
      exportedAt: new Date().toISOString(),
      plantId: document.getElementById('plant-id-input')?.value ?? 'plant-01',
      sensors: SENSORS.map(s => ({ id: s.id, label: s.label, unit: s.unit })),
      snapshots: history.length > 0 ? history : [],
      // Nota explícita si no hay datos
      note: history.length === 0 ? 'No data recorded yet' : undefined,
    };

    const content = JSON.stringify(payload, null, 2);
    const filename = `wtp-export-${this._timestamp()}.json`;

    this._download(content, filename, 'application/json;charset=utf-8;');

    EventBus.emit(EVENTS.EXPORT_COMPLETE, {
      format: 'json',
      rowCount: history.length,
    });
  },

  /**
   * Dispara la descarga de un archivo en el navegador.
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  _download(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revocar la URL después de un tick para que la descarga se complete
    setTimeout(() => URL.revokeObjectURL(url), 100);
  },

  /**
   * Timestamp compacto para el nombre del archivo.
   * @returns {string} e.g. '20250115-143022'
   */
  _timestamp() {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      '-',
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0'),
    ].join('');
  },

  /**
   * Limpieza. Llamar si se desmonta la app.
   */
  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.EXPORT_STARTED, this._handler);
      this._handler = null;
    }
  },
};

export default DataExporter;