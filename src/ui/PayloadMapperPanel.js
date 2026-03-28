/**
 * PayloadMapperPanel.js — UI para configurar el payload mapper.
 *
 * Modal accesible desde ConfigModal (botón "Payload mapping →").
 * Permite al usuario:
 *   1. Elegir el modo (auto / flat / custom)
 *   2. Pegar un mensaje de ejemplo y ver qué detecta el auto-mapper
 *   3. Configurar mappings custom (from → to)
 *   4. Guardar la configuración
 */

import PayloadMapper, {
  loadMapConfig,
  saveMapConfig,
} from '../utils/PayloadMapper.js';
import { SENSORS } from '../sensors/SensorConfig.js';

const SENSOR_IDS = SENSORS.map(s => s.id);

const PayloadMapperPanel = {
  _overlay: null,

  init() {
    this._build();
    const btn = document.getElementById('btn-payload-mapper');
    if (btn) btn.addEventListener('click', () => this.open());
  },

  open() {
    const cfg = loadMapConfig();
    this._applyConfig(cfg);
    this._overlay.classList.add('visible');
  },

  close() {
    this._overlay.classList.remove('visible');
  },

  _build() {
    const sensorOptions = SENSOR_IDS.map(id =>
      `<option value="${id}">${id}</option>`
    ).join('');

    const el = document.createElement('div');
    el.id = 'mapper-overlay';
    el.innerHTML = `
      <div id="mapper-modal" role="dialog">

        <div id="mapper-header">
          <span id="mapper-title">Payload Mapping</span>
          <button id="mapper-close">✕</button>
        </div>

        <div id="mapper-body">

          <!-- Modo -->
          <div class="mapper-section">
            <label class="mapper-section-title">Mode</label>
            <div class="mapper-modes">
              <label class="mapper-mode-option">
                <input type="radio" name="mapper-mode" value="auto" />
                <div class="mapper-mode-card">
                  <span class="mapper-mode-name">Auto detect</span>
                  <span class="mapper-mode-desc">Handles native format, Sparkplug-like arrays, flat fields</span>
                </div>
              </label>
              <label class="mapper-mode-option">
                <input type="radio" name="mapper-mode" value="flat" />
                <div class="mapper-mode-card">
                  <span class="mapper-mode-name">Flat fields</span>
                  <span class="mapper-mode-desc">All numeric root-level fields become sensor readings</span>
                </div>
              </label>
              <label class="mapper-mode-option">
                <input type="radio" name="mapper-mode" value="custom" />
                <div class="mapper-mode-card">
                  <span class="mapper-mode-name">Custom mapping</span>
                  <span class="mapper-mode-desc">Define exactly which fields map to which sensors</span>
                </div>
              </label>
            </div>
          </div>

          <!-- Timestamp field -->
          <div class="mapper-section">
            <label class="mapper-section-title">Timestamp field <span class="mapper-optional">(optional)</span></label>
            <input class="mapper-input" id="mapper-ts-field" type="text"
              placeholder="e.g. ts or data.timestamp — leave empty to use Date.now()" />
          </div>

          <!-- Analizador de ejemplo -->
          <div class="mapper-section">
            <label class="mapper-section-title">Paste a sample message to analyze</label>
            <textarea class="mapper-input mapper-textarea" id="mapper-sample"
              placeholder='{"ts": 1234567890, "flow": 142.3, "ph": 7.1}'
              rows="4"></textarea>
            <button class="mapper-btn-ghost" id="mapper-analyze-btn">Analyze →</button>
            <div id="mapper-analyze-result" style="display:none;"></div>
          </div>

          <!-- Mappings custom -->
          <div class="mapper-section" id="mapper-custom-section" style="display:none;">
            <label class="mapper-section-title">Custom field mappings</label>
            <div id="mapper-mappings-list"></div>
            <button class="mapper-btn-ghost" id="mapper-add-mapping">+ Add mapping</button>
          </div>

        </div>

        <div id="mapper-footer">
          <button id="mapper-cancel" class="mapper-btn-ghost">Cancel</button>
          <button id="mapper-save"   class="mapper-btn-primary">Save</button>
        </div>

      </div>

      <!-- Template oculto para una fila de mapping -->
      <template id="mapper-row-tpl">
        <div class="mapper-mapping-row">
          <input class="mapper-input mapper-from" type="text" placeholder="from (e.g. data.flow)" />
          <span class="mapper-arrow">→</span>
          <select class="mapper-input mapper-to">
            <option value="">— sensor ID —</option>
            ${sensorOptions}
            <option value="__custom__">Custom ID…</option>
          </select>
          <input class="mapper-input mapper-to-custom" type="text"
            placeholder="custom sensor id" style="display:none;" />
          <button class="mapper-btn-icon mapper-remove-row">✕</button>
        </div>
      </template>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.classList.contains('visible')) this.close();
    });

    document.getElementById('mapper-close').addEventListener('click',  () => this.close());
    document.getElementById('mapper-cancel').addEventListener('click', () => this.close());
    document.getElementById('mapper-save').addEventListener('click',   () => this._save());
    document.getElementById('mapper-analyze-btn').addEventListener('click', () => this._analyze());
    document.getElementById('mapper-add-mapping').addEventListener('click', () => this._addMappingRow());

    // Mostrar/ocultar sección custom según el modo
    el.querySelectorAll('input[name="mapper-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isCustom = document.querySelector('input[name="mapper-mode"]:checked')?.value === 'custom';
        document.getElementById('mapper-custom-section').style.display = isCustom ? 'block' : 'none';
      });
    });
  },

  _applyConfig(cfg) {
    // Modo
    const radio = document.querySelector(`input[name="mapper-mode"][value="${cfg.mode}"]`);
    if (radio) radio.checked = true;

    // Timestamp
    document.getElementById('mapper-ts-field').value = cfg.timestampField ?? '';

    // Sección custom
    const isCustom = cfg.mode === 'custom';
    document.getElementById('mapper-custom-section').style.display = isCustom ? 'block' : 'none';

    // Mappings
    const list = document.getElementById('mapper-mappings-list');
    list.innerHTML = '';
    (cfg.mappings ?? []).forEach(m => this._addMappingRow(m.from, m.to));
  },

  _analyze() {
    const sample  = document.getElementById('mapper-sample').value.trim();
    const result  = document.getElementById('mapper-analyze-result');
    const analysis = PayloadMapper.analyze(sample);

    if (!analysis) {
      result.style.display = 'block';
      result.innerHTML = `<span style="color:var(--red)">Invalid JSON — check the sample</span>`;
      return;
    }

    const detectedKeys = Object.keys(analysis.detected);
    if (detectedKeys.length === 0) {
      result.innerHTML = `<span style="color:var(--amber)">No numeric fields detected. Try custom mapping.</span>`;
    } else {
      result.innerHTML = `
        <span style="color:var(--green)">Detected ${detectedKeys.length} field(s):</span>
        <div class="mapper-detected-fields">${detectedKeys.map(k =>
          `<code class="mapper-code">${k}</code>`
        ).join('')}</div>
        <button class="mapper-btn-ghost mapper-use-suggested" style="margin-top:8px;">
          Use as custom mappings →
        </button>
      `;
      result.querySelector('.mapper-use-suggested')?.addEventListener('click', () => {
        // Cambiar a modo custom y pre-rellenar los mappings sugeridos
        const radio = document.querySelector('input[name="mapper-mode"][value="custom"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }

        const list = document.getElementById('mapper-mappings-list');
        list.innerHTML = '';
        analysis.suggested.forEach(m => this._addMappingRow(m.from, m.to));
      });
    }

    result.style.display = 'block';
  },

  _addMappingRow(from = '', to = '') {
    const tpl  = document.getElementById('mapper-row-tpl');
    const row  = tpl.content.cloneNode(true).querySelector('.mapper-mapping-row');
    const list = document.getElementById('mapper-mappings-list');

    row.querySelector('.mapper-from').value = from;

    const select = row.querySelector('.mapper-to');
    const customInput = row.querySelector('.mapper-to-custom');

    // Si 'to' no está en los sensor IDs predefinidos, usar custom
    if (to && !SENSOR_IDS.includes(to)) {
      select.value = '__custom__';
      customInput.style.display = 'block';
      customInput.value = to;
    } else {
      select.value = to;
    }

    select.addEventListener('change', () => {
      customInput.style.display = select.value === '__custom__' ? 'block' : 'none';
    });

    row.querySelector('.mapper-remove-row').addEventListener('click', () => row.remove());

    list.appendChild(row);
  },

  _save() {
    const mode = document.querySelector('input[name="mapper-mode"]:checked')?.value ?? 'auto';
    const timestampField = document.getElementById('mapper-ts-field').value.trim();

    const mappings = [];
    document.querySelectorAll('.mapper-mapping-row').forEach(row => {
      const from   = row.querySelector('.mapper-from').value.trim();
      const select = row.querySelector('.mapper-to');
      const to     = select.value === '__custom__'
        ? row.querySelector('.mapper-to-custom').value.trim()
        : select.value;
      if (from && to) mappings.push({ from, to });
    });

    saveMapConfig({ mode, timestampField, mappings });
    this.close();
  },

  destroy() {
    this._overlay?.remove();
    this._overlay = null;
  },
};

export default PayloadMapperPanel;