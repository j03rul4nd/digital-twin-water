/**
 * ReportPanel.js — Modal with 3 tabs (Template · Content · Branding),
 * live header preview, progress bar, and download button.
 *
 * Lifecycle: init() → open() / close() → destroy()
 * Follows the same cleanup pattern as all other UI panels.
 */

import ReportConfig     from '../reports/ReportConfig.js';
import ReportEngine     from '../reports/ReportEngine.js';
import { TEMPLATES, TEMPLATE_ORDER } from '../reports/ReportTemplates.js';
import { renderReportConfigUI, injectReportConfigStyles } from '../reports/renderReportConfigUI.js';
import { processLogoFile, validateLogoDataUrl } from '../reports/ReportBranding.js';
import SensorState      from '../sensors/SensorState.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [26, 74, 122];
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const ReportPanel = {
  _overlay:     null,
  _activeTab:   'template',
  _unsubscribe: null,
  _isOpen:      false,

  init() {
    injectReportConfigStyles();
    this._injectStyles();
    this._build();
    ReportConfig.load();
    this._unsubscribe = ReportConfig.subscribe(() => {
      this._refreshPreview();
      this._refreshContentTab();
    });
  },

  open() {
    if (!this._overlay) return;
    this._overlay.classList.add('visible');
    this._isOpen = true;
    this._switchTab(this._activeTab);
    this._refreshPreview();
  },

  close() {
    if (!this._overlay) return;
    this._overlay.classList.remove('visible');
    this._isOpen = false;
  },

  destroy() {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    if (this._overlay)     { this._overlay.remove(); this._overlay = null; }
  },

  // ── Build DOM ───────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'report-panel-overlay';
    el.innerHTML = `
      <div id="report-modal" role="dialog" aria-modal="true" aria-label="Report Generator">

        <div id="report-modal-header">
          <span id="report-modal-title">Generate Report</span>
          <button id="report-modal-close" aria-label="Close">✕</button>
        </div>

        <!-- Tab bar -->
        <div id="report-tab-bar">
          <button class="report-tab active" data-tab="template">Template</button>
          <button class="report-tab" data-tab="content">Content</button>
          <button class="report-tab" data-tab="branding">Branding</button>
        </div>

        <!-- Tab panes -->
        <div id="report-tab-panes">

          <!-- Template tab -->
          <div class="report-pane" id="report-pane-template">
            <div id="report-template-grid"></div>
          </div>

          <!-- Content tab -->
          <div class="report-pane" id="report-pane-content" style="display:none;">
            <div id="report-content-cfg"></div>
          </div>

          <!-- Branding tab -->
          <div class="report-pane" id="report-pane-branding" style="display:none;">
            <div id="report-branding-cfg"></div>
          </div>

        </div>

        <!-- Preview + Generate row -->
        <div id="report-preview-row">

          <!-- Header preview canvas -->
          <div id="report-preview-wrap">
            <div class="report-preview-label">Header preview</div>
            <canvas id="report-preview-canvas" width="480" height="64"></canvas>
          </div>

          <!-- Right: root cause + progress + button -->
          <div id="report-action-col">
            <div id="report-rootcause-wrap">
              <label class="report-field-label">Root cause notes (incident report)</label>
              <textarea id="report-rootcause" placeholder="Describe the incident root cause…" rows="3"></textarea>
            </div>
            <div id="report-progress-wrap" style="display:none;">
              <div id="report-progress-bar-track">
                <div id="report-progress-bar-fill"></div>
              </div>
              <div id="report-progress-label">Preparing…</div>
            </div>
            <div id="report-error-msg" style="display:none;"></div>
            <button id="report-generate-btn" disabled>📄 Generate PDF</button>
          </div>
        </div>

      </div>
    `;
    document.body.appendChild(el);
    this._overlay = el;

    // Close on backdrop click
    el.addEventListener('click', e => {
      if (e.target === el) this.close();
    });

    // Close button
    el.querySelector('#report-modal-close').addEventListener('click', () => this.close());

    // Tab switching
    el.querySelectorAll('.report-tab').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });

    // Generate button
    el.querySelector('#report-generate-btn').addEventListener('click', () => this._generate());

    // Build template grid
    this._buildTemplateGrid();

    // Build branding form
    this._buildBrandingForm();

    // Enable generate btn when sensor data is ready (check periodically)
    this._refreshGenerateBtn();
    this._readyTimer = setInterval(() => this._refreshGenerateBtn(), 2000);
  },

  // ── Template grid ───────────────────────────────────────────────────────────

  _buildTemplateGrid() {
    const grid = this._overlay.querySelector('#report-template-grid');
    if (!grid) return;
    const cfg = ReportConfig.get();

    let html = '';
    for (const id of TEMPLATE_ORDER) {
      const t = TEMPLATES[id];
      const active = cfg.template === id ? ' report-tpl-card--active' : '';
      html += `
        <div class="report-tpl-card${active}" data-tpl="${id}">
          <div class="report-tpl-icon">${t.icon}</div>
          <div class="report-tpl-name">${t.label}</div>
          <div class="report-tpl-pages">${t.pages}</div>
          <div class="report-tpl-desc">${t.description}</div>
          <ul class="report-tpl-uses">
            ${t.useCases.map(u => `<li>${u}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.report-tpl-card').forEach(card => {
      card.addEventListener('click', () => {
        const tpl = card.dataset.tpl;
        ReportConfig.set('template', null, tpl);
        // Apply template section defaults
        const defaults = TEMPLATES[tpl]?.sectionDefaults ?? {};
        for (const [k, v] of Object.entries(defaults)) {
          ReportConfig.set('sections', k, v);
        }
        grid.querySelectorAll('.report-tpl-card').forEach(c =>
          c.classList.toggle('report-tpl-card--active', c.dataset.tpl === tpl)
        );
      });
    });
  },

  _refreshTemplateGrid() {
    const grid = this._overlay?.querySelector('#report-template-grid');
    if (!grid) return;
    const active = ReportConfig.get().template;
    grid.querySelectorAll('.report-tpl-card').forEach(c =>
      c.classList.toggle('report-tpl-card--active', c.dataset.tpl === active)
    );
  },

  // ── Content tab ─────────────────────────────────────────────────────────────

  _refreshContentTab() {
    const container = this._overlay?.querySelector('#report-content-cfg');
    if (!container || container.closest('.report-pane')?.style.display === 'none') return;
    renderReportConfigUI(container);
  },

  // ── Branding form ────────────────────────────────────────────────────────────

  _buildBrandingForm() {
    const container = this._overlay?.querySelector('#report-branding-cfg');
    if (!container) return;
    const cfg = ReportConfig.get();
    const b = cfg.branding;

    container.innerHTML = `
      <div class="rpt-cfg-group">
        <div class="rpt-cfg-group-title">Company</div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Company name</label>
          <input type="text" class="rpt-brand-text" id="rpt-company-name" value="${_esc(b.companyName)}" placeholder="Water Operations Co.">
        </div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Plant name</label>
          <input type="text" class="rpt-brand-text" id="rpt-plant-name" value="${_esc(b.plantName)}" placeholder="Plant #1">
        </div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Plant ID</label>
          <input type="text" class="rpt-brand-text" id="rpt-plant-id" value="${_esc(b.plantId)}" placeholder="plant-01">
        </div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Location</label>
          <input type="text" class="rpt-brand-text" id="rpt-plant-location" value="${_esc(b.plantLocation)}" placeholder="City, Country">
        </div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Report author</label>
          <input type="text" class="rpt-brand-text" id="rpt-author" value="${_esc(b.reportAuthor)}" placeholder="Operator name">
        </div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Footer text</label>
          <input type="text" class="rpt-brand-text" id="rpt-footer-text" value="${_esc(b.footerText)}" placeholder="Confidential…">
        </div>
      </div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-group-title">Colors</div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Primary color (header bg)</label>
          <div class="rpt-color-wrap">
            <input type="color" class="rpt-color-input" id="rpt-primary-color" value="${b.primaryColor}">
            <input type="text" class="rpt-brand-text rpt-brand-text--color" id="rpt-primary-color-hex" value="${b.primaryColor}" maxlength="7">
          </div>
        </div>
        <div class="rpt-cfg-param">
          <label class="rpt-cfg-param-label">Accent color (badges, bars)</label>
          <div class="rpt-color-wrap">
            <input type="color" class="rpt-color-input" id="rpt-accent-color" value="${b.accentColor}">
            <input type="text" class="rpt-brand-text rpt-brand-text--color" id="rpt-accent-color-hex" value="${b.accentColor}" maxlength="7">
          </div>
        </div>
      </div>

      <div class="rpt-cfg-group">
        <div class="rpt-cfg-group-title">Logo</div>
        <div id="rpt-logo-drop" class="rpt-logo-drop" tabindex="0" role="button"
             aria-label="Upload company logo">
          ${b.companyLogo
            ? `<img id="rpt-logo-preview-img" src="${b.companyLogo}" alt="Logo">`
            : `<span id="rpt-logo-placeholder">Click or drag a PNG/JPG logo here<br><small>Max 2 MB · Will be resized to 400×400 px</small></span>`
          }
        </div>
        <input type="file" id="rpt-logo-input" accept="image/png,image/jpeg" style="display:none;">
        <div id="rpt-logo-error" class="rpt-error-msg" style="display:none;"></div>
        ${b.companyLogo ? '<button id="rpt-logo-remove" class="rpt-cfg-reset">✕ Remove logo</button>' : ''}
      </div>
    `;

    this._wireBrandingEvents(container);
  },

  _wireBrandingEvents(container) {
    const bind = (id, key) => {
      const el = container.querySelector(`#${id}`);
      if (!el) return;
      el.addEventListener('input', e => ReportConfig.set('branding', key, e.target.value));
    };

    bind('rpt-company-name',   'companyName');
    bind('rpt-plant-name',     'plantName');
    bind('rpt-plant-id',       'plantId');
    bind('rpt-plant-location', 'plantLocation');
    bind('rpt-author',         'reportAuthor');
    bind('rpt-footer-text',    'footerText');

    // Color pickers — sync color input ↔ hex text
    const syncColor = (colorId, hexId, key) => {
      const colorEl = container.querySelector(`#${colorId}`);
      const hexEl   = container.querySelector(`#${hexId}`);
      if (!colorEl || !hexEl) return;
      colorEl.addEventListener('input', e => {
        hexEl.value = e.target.value;
        ReportConfig.set('branding', key, e.target.value);
      });
      hexEl.addEventListener('input', e => {
        const v = e.target.value;
        if (/^#[0-9a-f]{6}$/i.test(v)) {
          colorEl.value = v;
          ReportConfig.set('branding', key, v);
        }
      });
    };
    syncColor('rpt-primary-color', 'rpt-primary-color-hex', 'primaryColor');
    syncColor('rpt-accent-color',  'rpt-accent-color-hex',  'accentColor');

    // Logo drop zone
    const drop    = container.querySelector('#rpt-logo-drop');
    const fileIn  = container.querySelector('#rpt-logo-input');
    const errEl   = container.querySelector('#rpt-logo-error');

    const handleFile = async (file) => {
      if (!file) return;
      try {
        const b64 = await processLogoFile(file);
        ReportConfig.setLogo(b64);
        this._buildBrandingForm();  // rebuild to show logo preview + remove btn
      } catch (e) {
        _showError(errEl, e.message);
      }
    };

    drop?.addEventListener('click', () => fileIn?.click());
    drop?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileIn?.click(); });
    drop?.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop?.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop?.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      handleFile(e.dataTransfer?.files?.[0]);
    });

    fileIn?.addEventListener('change', e => handleFile(e.target.files?.[0]));

    container.querySelector('#rpt-logo-remove')?.addEventListener('click', () => {
      ReportConfig.clearLogo();
      this._buildBrandingForm();
    });
  },

  // ── Tab switching ───────────────────────────────────────────────────────────

  _switchTab(tab) {
    this._activeTab = tab;
    const panes = this._overlay?.querySelectorAll('.report-pane');
    panes?.forEach(p => {
      p.style.display = p.id === `report-pane-${tab}` ? '' : 'none';
    });
    this._overlay?.querySelectorAll('.report-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (tab === 'content') {
      renderReportConfigUI(this._overlay.querySelector('#report-content-cfg'));
    }
    if (tab === 'branding') {
      this._buildBrandingForm();
    }
    if (tab === 'template') {
      this._refreshTemplateGrid();
    }
  },

  // ── Preview canvas ──────────────────────────────────────────────────────────

  _refreshPreview() {
    const canvas = this._overlay?.querySelector('#report-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    const cfg = ReportConfig.get();
    const b   = cfg.branding;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Header background
    const [r, g, bv] = hexToRgb(b.primaryColor || '#1a4a7a');
    ctx.fillStyle = `rgb(${r},${g},${bv})`;
    ctx.fillRect(0, 0, W, H);

    // Logo (if any)
    let textX = 12;
    if (b.companyLogo) {
      try {
        const img = new Image();
        img.src = b.companyLogo;
        if (img.complete) {
          const size = H * 0.7;
          const ly   = (H - size) / 2;
          ctx.drawImage(img, 8, ly, size, size);
          textX = size + 14;
        }
      } catch {}
    }

    // Company name
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(H * 0.28)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(b.companyName || 'Water Operations Co.', textX, H * 0.42);

    // Report title
    ctx.fillStyle = 'rgba(200,215,230,0.9)';
    ctx.font = `${Math.round(H * 0.2)}px Arial, Helvetica, sans-serif`;
    const titles = { SHIFT_HANDOVER: 'Shift Handover Report', INCIDENT_REPORT: 'Incident Report', EXECUTIVE_SUMMARY: 'Executive Summary' };
    ctx.fillText(titles[cfg.template] || 'Plant Status Report', textX, H * 0.65);

    // Accent badge
    const [ar, ag, ab] = hexToRgb(b.accentColor || '#0ea5e9');
    ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
    const bw = 80, bh = H * 0.35, bx = W - bw - 10, by = H * 0.32;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(bx, by, bw, bh, 3);
    } else {
      ctx.rect(bx, by, bw, bh);
    }
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font      = `bold ${Math.round(H * 0.18)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('WTP DIGITAL TWIN', bx + bw / 2, by + bh * 0.68);
    ctx.textAlign = 'left';
  },

  // ── Generate button state ───────────────────────────────────────────────────

  _refreshGenerateBtn() {
    const btn = this._overlay?.querySelector('#report-generate-btn');
    if (!btn) return;
    const ready = SensorState.isReady();
    btn.disabled = !ready;
    btn.title = ready ? 'Generate and download PDF' : 'No sensor data — start simulation or MQTT first';
  },

  // ── PDF generation ──────────────────────────────────────────────────────────

  async _generate() {
    const btn      = this._overlay?.querySelector('#report-generate-btn');
    const progWrap = this._overlay?.querySelector('#report-progress-wrap');
    const progFill = this._overlay?.querySelector('#report-progress-bar-fill');
    const progLbl  = this._overlay?.querySelector('#report-progress-label');
    const errEl    = this._overlay?.querySelector('#report-error-msg');
    const rootCause = this._overlay?.querySelector('#report-rootcause')?.value ?? '';

    _hideError(errEl);

    if (btn) {
      btn.disabled    = true;
      btn.textContent = '⏳ Generating…';
    }
    if (progWrap) progWrap.style.display = '';

    const setProgress = (pct, label) => {
      if (progFill) progFill.style.width = `${pct}%`;
      if (progLbl)  progLbl.textContent  = label;
    };

    try {
      const blob = await ReportEngine.generateReport({
        rootCause,
        onProgress: setProgress,
        onError:    (e) => _showError(errEl, e.message),
      });

      ReportEngine.downloadBlob(blob, ReportConfig.get().template);

      if (btn) {
        btn.textContent = '✓ Downloaded!';
        setTimeout(() => {
          btn.textContent = '📄 Generate PDF';
          btn.disabled    = false;
        }, 2500);
      }

    } catch (err) {
      _showError(errEl, err?.message ?? 'PDF generation failed.');
      if (btn) {
        btn.textContent = '📄 Generate PDF';
        btn.disabled    = false;
      }
    } finally {
      setTimeout(() => {
        if (progWrap) progWrap.style.display = 'none';
        if (progFill) progFill.style.width   = '0%';
      }, 2000);
    }
  },

  // ── Styles ──────────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('report-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'report-panel-styles';
    style.textContent = `
/* ── Overlay ──────────────────────────────────────────────────── */
#report-panel-overlay {
  position: fixed; inset: 0; z-index: 120;
  background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transition: opacity 0.18s ease;
}
#report-panel-overlay.visible {
  opacity: 1; pointer-events: auto;
}

/* ── Modal shell ──────────────────────────────────────────────── */
#report-modal {
  background: var(--bg1);
  border: 1px solid var(--line2);
  border-radius: 10px;
  width: min(860px, 96vw);
  max-height: 92vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.6);
}

/* ── Header ───────────────────────────────────────────────────── */
#report-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
#report-modal-title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 12px; font-weight: 500; color: var(--text0);
}
#report-modal-close {
  background: none; border: none; color: var(--text2);
  font-size: 13px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
  transition: color 0.12s, background 0.12s;
}
#report-modal-close:hover { color: var(--text0); background: var(--bg3); }

/* ── Tab bar ──────────────────────────────────────────────────── */
#report-tab-bar {
  display: flex; gap: 0;
  background: var(--bg2);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.report-tab {
  flex: 1; padding: 8px 12px;
  background: none; border: none; border-bottom: 2px solid transparent;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 10px; font-weight: 500;
  color: var(--text2); cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.report-tab:hover  { color: var(--text1); }
.report-tab.active { color: var(--blue, #3b82f6); border-bottom-color: var(--blue, #3b82f6); }

/* ── Panes ─────────────────────────────────────────────────────── */
#report-tab-panes {
  flex: 1; overflow-y: auto; padding: 14px 16px;
  min-height: 200px;
}
.report-pane {}

/* ── Template grid ────────────────────────────────────────────── */
#report-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.report-tpl-card {
  background: var(--bg2); border: 1px solid var(--line);
  border-radius: 8px; padding: 12px 14px; cursor: pointer;
  transition: border-color 0.14s, background 0.14s;
}
.report-tpl-card:hover { border-color: var(--line2); background: var(--bg3); }
.report-tpl-card--active {
  border-color: var(--blue, #3b82f6);
  background: rgba(59,130,246,0.06);
}
.report-tpl-icon { font-size: 20px; margin-bottom: 6px; }
.report-tpl-name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 11px; font-weight: 500; color: var(--text0); margin-bottom: 2px;
}
.report-tpl-pages {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--blue, #3b82f6); margin-bottom: 6px;
}
.report-tpl-desc {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--text1); line-height: 1.4; margin-bottom: 6px;
}
.report-tpl-uses {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.report-tpl-uses li {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8.5px; color: var(--text2);
}
.report-tpl-uses li::before { content: '· '; }

/* ── Branding form ────────────────────────────────────────────── */
.rpt-brand-text {
  width: 180px; background: var(--bg2); border: 1px solid var(--line2);
  color: var(--text0); border-radius: 3px; padding: 3px 7px;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 9.5px;
}
.rpt-brand-text:focus { outline: none; border-color: var(--blue, #60a5fa); }
.rpt-brand-text--color { width: 70px; font-family: 'JetBrains Mono', monospace; }
.rpt-color-wrap { display: flex; align-items: center; gap: 6px; }
.rpt-color-input {
  width: 28px; height: 24px; padding: 1px;
  border: 1px solid var(--line2); border-radius: 3px;
  background: none; cursor: pointer;
}

/* Logo drop zone */
.rpt-logo-drop {
  border: 1.5px dashed var(--line2); border-radius: 6px;
  padding: 16px; text-align: center; cursor: pointer;
  transition: border-color 0.14s;
  min-height: 72px; display: flex; align-items: center; justify-content: center;
}
.rpt-logo-drop:hover, .rpt-logo-drop.drag-over {
  border-color: var(--blue, #3b82f6);
}
#rpt-logo-placeholder {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9.5px; color: var(--text2); line-height: 1.5;
}
#rpt-logo-placeholder small { font-size: 8.5px; color: var(--text2); }
#rpt-logo-preview-img {
  max-width: 80px; max-height: 50px; object-fit: contain;
}

/* Error */
.rpt-error-msg {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--red, #ef4444);
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
  border-radius: 4px; padding: 5px 8px; margin-top: 4px;
}

/* ── Preview + action row ─────────────────────────────────────── */
#report-preview-row {
  display: flex; gap: 16px; align-items: flex-start;
  padding: 12px 16px;
  background: var(--bg2);
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}
#report-preview-wrap { flex-shrink: 0; }
.report-preview-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8.5px; color: var(--text2); margin-bottom: 5px;
  text-transform: uppercase; letter-spacing: 0.07em;
}
#report-preview-canvas {
  display: block; border-radius: 4px;
  width: 320px; height: auto;
  border: 1px solid var(--line);
}

#report-action-col {
  flex: 1; display: flex; flex-direction: column; gap: 8px;
}
#report-rootcause-wrap { display: flex; flex-direction: column; gap: 4px; }
.report-field-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8.5px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.07em;
}
#report-rootcause {
  width: 100%; background: var(--bg1); border: 1px solid var(--line2);
  border-radius: 4px; color: var(--text1); padding: 6px 8px; resize: vertical;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 9.5px; line-height: 1.4;
}
#report-rootcause:focus { outline: none; border-color: var(--blue, #60a5fa); color: var(--text0); }

/* Progress */
#report-progress-bar-track {
  height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden;
}
#report-progress-bar-fill {
  height: 100%; width: 0%;
  background: var(--blue, #3b82f6);
  border-radius: 2px;
  transition: width 0.25s ease;
}
#report-progress-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px; color: var(--text2); margin-top: 3px;
}
#report-error-msg {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--red, #ef4444);
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
  border-radius: 4px; padding: 5px 8px;
}

/* Generate button */
#report-generate-btn {
  align-self: flex-end;
  padding: 7px 18px;
  background: var(--blue, #3b82f6); color: #fff;
  border: none; border-radius: 5px; cursor: pointer;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 10px; font-weight: 500;
  transition: background 0.14s, opacity 0.14s;
}
#report-generate-btn:hover:not(:disabled) { background: #2563eb; }
#report-generate-btn:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 680px) {
  #report-preview-row { flex-direction: column; }
  #report-preview-canvas { width: 100%; }
  #report-template-grid { grid-template-columns: 1fr; }
}
    `;
    document.head.appendChild(style);
  },
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function _showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

function _hideError(el) {
  if (!el) return;
  el.textContent   = '';
  el.style.display = 'none';
}

export default ReportPanel;
