/**
 * renderFinancialConfigUI.js — Shared financial config UI renderer.
 *
 * Pure DOM renderer: takes a container element and populates it with
 * toggle + numeric inputs wired to FinancialConfig.
 * Called identically from SensorDetailModal and ConfigModal.
 */

import FinancialConfig from './FinancialConfig.js';

const METRIC_LABELS = {
  oee:            'OEE',
  costPerUnit:    'Cost per unit',
  degradation:    'Degradation',
  volatility:     'Volatility',
  sharpe:         'Sharpe ratio',
  economicImpact: 'Economic impact',
};

const PARAM_LABELS = {
  energyCostPerHour:    'Energy cost (€/kWh)',
  pumpPowerKW:          'Pump power (kW)',
  chemicalCostPerM3:    'Chemical cost (€/m³)',
  minSamples:           'Min samples',
  windowSize:           'Window size',
  baseline:             'Baseline (0 = normal.low)',
  costPerDeviationUnit: 'Cost / deviation unit (€)',
  costPerHourDowntime:  'Downtime cost (€/h)',
};

export function renderFinancialConfigUI(container) {
  if (!container) return;
  const cfg = FinancialConfig.get();

  let html = '<div class="fin-cfg-wrap">';

  for (const [metricKey, params] of Object.entries(cfg)) {
    const label = METRIC_LABELS[metricKey] ?? metricKey;
    html += `<div class="fin-cfg-metric">`;
    html += `<label class="fin-cfg-toggle-label">`;
    html += `<input type="checkbox" class="fin-cfg-check" data-metric="${metricKey}"${params.enabled ? ' checked' : ''}>`;
    html += ` ${label}`;
    html += `</label>`;

    for (const [paramKey, val] of Object.entries(params)) {
      if (paramKey === 'enabled') continue;
      const pLabel = PARAM_LABELS[paramKey] ?? paramKey;
      const step   = val < 1 ? '0.001' : val < 10 ? '0.1' : '1';
      html += `<div class="fin-cfg-param">`;
      html += `<label class="fin-cfg-param-label">${pLabel}</label>`;
      html += `<input type="number" class="fin-cfg-num" `;
      html += `data-metric="${metricKey}" data-param="${paramKey}" `;
      html += `value="${val}" step="${step}" min="0">`;
      html += `</div>`;
    }

    html += `</div>`;
  }

  html += `<button class="fin-cfg-reset">↺ Reset to defaults</button>`;
  html += '</div>';

  container.innerHTML = html;

  // ── Wire events ──────────────────────────────────────────────────────────
  container.querySelectorAll('.fin-cfg-check').forEach(input => {
    input.addEventListener('change', e => {
      FinancialConfig.setEnabled(e.target.dataset.metric, e.target.checked);
    });
  });

  container.querySelectorAll('.fin-cfg-num').forEach(input => {
    input.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) FinancialConfig.set(e.target.dataset.metric, e.target.dataset.param, v);
    });
  });

  container.querySelector('.fin-cfg-reset')?.addEventListener('click', () => {
    FinancialConfig.reset();
    renderFinancialConfigUI(container);
  });
}

// ── Shared styles (injected once) ─────────────────────────────────────────────

export function injectFinancialConfigStyles() {
  if (document.getElementById('fin-cfg-styles')) return;
  const style = document.createElement('style');
  style.id = 'fin-cfg-styles';
  style.textContent = `
.fin-cfg-wrap {
  display: flex; flex-direction: column; gap: 1px;
}
.fin-cfg-metric {
  background: var(--bg1);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 5px;
  margin-bottom: 4px;
}
.fin-cfg-toggle-label {
  display: flex; align-items: center; gap: 6px;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 10px; font-weight: 500; color: var(--text0);
  cursor: pointer; user-select: none;
}
.fin-cfg-check { cursor: pointer; accent-color: var(--blue, #60a5fa); }
.fin-cfg-param {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding-left: 18px;
}
.fin-cfg-param-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; color: var(--text2); flex: 1;
}
.fin-cfg-num {
  width: 80px; background: var(--bg2); border: 1px solid var(--line2);
  color: var(--text0); border-radius: 3px; padding: 2px 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
  text-align: right;
}
.fin-cfg-num:focus { outline: none; border-color: var(--blue, #60a5fa); }
.fin-cfg-reset {
  margin-top: 4px; padding: 5px 10px;
  background: var(--bg2); border: 1px solid var(--line2);
  color: var(--text2); border-radius: 4px; cursor: pointer;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 9px;
  transition: color 0.12s, border-color 0.12s;
  align-self: flex-start;
}
.fin-cfg-reset:hover { color: var(--text0); border-color: var(--line3, #444); }
  `;
  document.head.appendChild(style);
}
