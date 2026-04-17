/**
 * renderReportConfigUI.js — DOM renderer for the report configuration UI.
 *
 * Follows the same pattern as renderFinancialConfigUI.js:
 * takes a container element and populates it with controls wired to ReportConfig.
 * Used by ReportPanel (Content tab).
 */

import ReportConfig from './ReportConfig.js';

const SECTION_LABELS = {
  includeKPIs:                'Include KPI row',
  includeActiveAlerts:        'Include active alerts',
  includeResolvedAlerts:      'Include resolved alerts',
  includeSensorCharts:        'Include sensor charts',
  includeStatisticalAnalysis: 'Include statistical analysis',
  includeCostAnalysis:        'Include cost analysis',
  includeSignatureLine:       'Include signature line',
};

export function renderReportConfigUI(container) {
  if (!container) return;
  const cfg = ReportConfig.get();

  let html = '<div class="rpt-cfg-wrap">';

  // ── Section toggles ──────────────────────────────────────────────────────
  html += '<div class="rpt-cfg-group">';
  html += '<div class="rpt-cfg-group-title">Sections</div>';

  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    const checked = cfg.sections[key] ? ' checked' : '';
    html += `<label class="rpt-cfg-toggle-label">`;
    html += `<input type="checkbox" class="rpt-cfg-check" data-key="${key}"${checked}>`;
    html += ` ${label}`;
    html += `</label>`;
  }
  html += '</div>';

  // ── Numeric params ────────────────────────────────────────────────────────
  html += '<div class="rpt-cfg-group">';
  html += '<div class="rpt-cfg-group-title">Chart options</div>';

  html += `<div class="rpt-cfg-param">`;
  html += `<label class="rpt-cfg-param-label">Max sensors to chart</label>`;
  html += `<input type="number" class="rpt-cfg-num" id="rpt-max-sensors" `;
  html += `min="1" max="6" step="1" value="${cfg.sections.maxSensorsToChart}">`;
  html += `</div>`;

  html += `<div class="rpt-cfg-param">`;
  html += `<label class="rpt-cfg-param-label">Chart window (seconds)</label>`;
  html += `<select class="rpt-cfg-select" id="rpt-chart-window">`;
  for (const val of [60, 120, 180, 300]) {
    const sel = cfg.sections.chartTimeWindowSeconds === val ? ' selected' : '';
    html += `<option value="${val}"${sel}>${val}s</option>`;
  }
  html += `</select>`;
  html += `</div>`;

  html += '</div>';

  // ── Page format ───────────────────────────────────────────────────────────
  html += '<div class="rpt-cfg-group">';
  html += '<div class="rpt-cfg-group-title">Page format</div>';

  html += `<div class="rpt-cfg-param">`;
  html += `<label class="rpt-cfg-param-label">Format</label>`;
  html += `<select class="rpt-cfg-select" id="rpt-page-format">`;
  html += `<option value="a4"${cfg.pageFormat === 'a4' ? ' selected' : ''}>A4</option>`;
  html += `<option value="letter"${cfg.pageFormat === 'letter' ? ' selected' : ''}>Letter</option>`;
  html += `</select>`;
  html += `</div>`;

  html += `<div class="rpt-cfg-param">`;
  html += `<label class="rpt-cfg-param-label">Orientation</label>`;
  html += `<select class="rpt-cfg-select" id="rpt-orientation">`;
  html += `<option value="portrait"${cfg.orientation === 'portrait' ? ' selected' : ''}>Portrait</option>`;
  html += `<option value="landscape"${cfg.orientation === 'landscape' ? ' selected' : ''}>Landscape</option>`;
  html += `</select>`;
  html += `</div>`;

  html += '</div>';

  html += `<button class="rpt-cfg-reset">↺ Reset to defaults</button>`;
  html += '</div>';

  container.innerHTML = html;

  // ── Wire events ───────────────────────────────────────────────────────────
  container.querySelectorAll('.rpt-cfg-check').forEach(input => {
    input.addEventListener('change', e => {
      ReportConfig.set('sections', e.target.dataset.key, e.target.checked);
    });
  });

  container.querySelector('#rpt-max-sensors')?.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) ReportConfig.set('sections', 'maxSensorsToChart', v);
  });

  container.querySelector('#rpt-chart-window')?.addEventListener('change', e => {
    ReportConfig.set('sections', 'chartTimeWindowSeconds', parseInt(e.target.value, 10));
  });

  container.querySelector('#rpt-page-format')?.addEventListener('change', e => {
    ReportConfig.set('pageFormat', null, e.target.value);
  });

  container.querySelector('#rpt-orientation')?.addEventListener('change', e => {
    ReportConfig.set('orientation', null, e.target.value);
  });

  container.querySelector('.rpt-cfg-reset')?.addEventListener('click', () => {
    ReportConfig.reset();
    renderReportConfigUI(container);
  });
}

// ── Shared styles (injected once) ────────────────────────────────────────────

export function injectReportConfigStyles() {
  if (document.getElementById('rpt-cfg-styles')) return;
  const style = document.createElement('style');
  style.id = 'rpt-cfg-styles';
  style.textContent = `
.rpt-cfg-wrap {
  display: flex; flex-direction: column; gap: 8px;
}
.rpt-cfg-group {
  background: var(--bg1);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 5px;
}
.rpt-cfg-group-title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; font-weight: 500; color: var(--text2);
  text-transform: uppercase; letter-spacing: 0.08em;
  margin-bottom: 3px;
}
.rpt-cfg-toggle-label {
  display: flex; align-items: center; gap: 6px;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 10px; color: var(--text1);
  cursor: pointer; user-select: none;
}
.rpt-cfg-toggle-label:hover { color: var(--text0); }
.rpt-cfg-check { cursor: pointer; accent-color: var(--blue, #60a5fa); }
.rpt-cfg-param {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.rpt-cfg-param-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--text2); flex: 1;
}
.rpt-cfg-num, .rpt-cfg-select {
  width: 80px; background: var(--bg2); border: 1px solid var(--line2);
  color: var(--text0); border-radius: 3px; padding: 2px 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
}
.rpt-cfg-num:focus, .rpt-cfg-select:focus { outline: none; border-color: var(--blue, #60a5fa); }
.rpt-cfg-reset {
  margin-top: 2px; padding: 5px 10px;
  background: var(--bg2); border: 1px solid var(--line2);
  color: var(--text2); border-radius: 4px; cursor: pointer;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 9px;
  transition: color 0.12s, border-color 0.12s;
  align-self: flex-start;
}
.rpt-cfg-reset:hover { color: var(--text0); border-color: var(--line3, #444); }
  `;
  document.head.appendChild(style);
}
