/**
 * KPIPanel.js — Panel de KPIs de proceso.
 *
 * Panel flotante accesible desde un botón en el topbar (📊 KPIs).
 * Muestra las métricas calculadas por KPIEngine en tiempo real.
 * Se actualiza cada vez que llega EVENTS.KPIS_UPDATED (cada 5s).
 *
 * El panel puede estar en modo minimizado (solo los 3 KPIs más críticos)
 * o expandido (todos los KPIs con detalle).
 */

import EventBus    from '../core/EventBus.js';
import { EVENTS }  from '../core/events.js';
import FinancialConfig from '../utils/FinancialConfig.js';
import ConfigModal from './ConfigModal.js';

const KPIPanel = {
  _overlay:  null,
  _handler:  null,
  _expanded: false,

  init() {
    this._build();
    this._injectStyles();

    this._handler = (kpis) => this._update(kpis);
    EventBus.on(EVENTS.KPIS_UPDATED, this._handler);

    const btn = document.getElementById('btn-kpis');
    if (btn) btn.addEventListener('click', () => this.open());
  },

  open() {
    this._overlay.classList.add('visible');
  },

  close() {
    this._overlay.classList.remove('visible');
  },

  _build() {
    const el = document.createElement('div');
    el.id = 'kpi-overlay';
    el.innerHTML = `
      <div id="kpi-modal" role="dialog">

        <div id="kpi-header">
          <div id="kpi-header-left">
            <span id="kpi-title">Process KPIs</span>
            <span id="kpi-session-label" class="kpi-meta"></span>
          </div>
          <button id="kpi-close">✕</button>
        </div>

        <div id="kpi-body">

          <!-- Fila principal — métricas de alto nivel -->
          <div class="kpi-grid-top">
            <div class="kpi-card kpi-card--primary">
              <div class="kpi-card-value" id="kpi-throughput">—</div>
              <div class="kpi-card-label">m³ Treated</div>
              <div class="kpi-card-sub" id="kpi-flow-avg">avg flow —</div>
            </div>
            <div class="kpi-card kpi-card--primary">
              <div class="kpi-card-value" id="kpi-chlorination-eff">—</div>
              <div class="kpi-card-label">Chlorination Eff.</div>
              <div class="kpi-card-sub">% time in normal range</div>
            </div>
            <div class="kpi-card kpi-card--primary">
              <div class="kpi-card-value" id="kpi-time-normal">—</div>
              <div class="kpi-card-label">Normal Operation</div>
              <div class="kpi-card-sub">% of session time</div>
            </div>
          </div>

          <!-- Barra de estado operacional -->
          <div class="kpi-status-bar-wrap">
            <div class="kpi-status-bar">
              <div class="kpi-status-normal"  id="kpi-bar-normal"  style="width:0%"></div>
              <div class="kpi-status-warning" id="kpi-bar-warning" style="width:0%"></div>
              <div class="kpi-status-danger"  id="kpi-bar-danger"  style="width:0%"></div>
            </div>
            <div class="kpi-status-legend">
              <span class="kpi-legend-dot" style="background:var(--green)"></span>
              <span id="kpi-legend-normal" class="kpi-legend-label">Normal</span>
              <span class="kpi-legend-dot" style="background:var(--amber)"></span>
              <span id="kpi-legend-warning" class="kpi-legend-label">Warning</span>
              <span class="kpi-legend-dot" style="background:var(--red)"></span>
              <span id="kpi-legend-danger" class="kpi-legend-label">Danger</span>
            </div>
          </div>

          <!-- Grid secundario -->
          <div class="kpi-grid-secondary">
            <div class="kpi-stat">
              <span class="kpi-stat-value" id="kpi-backwash">—</span>
              <span class="kpi-stat-label">Backwashes</span>
            </div>
            <div class="kpi-stat">
              <span class="kpi-stat-value" id="kpi-alerts">—</span>
              <span class="kpi-stat-label">Alerts fired</span>
            </div>
            <div class="kpi-stat">
              <span class="kpi-stat-value" id="kpi-chlorine-kg">—</span>
              <span class="kpi-stat-label">Cl₂ used (kg)</span>
            </div>
            <div class="kpi-stat">
              <span class="kpi-stat-value" id="kpi-samples">—</span>
              <span class="kpi-stat-label">Samples (3min)</span>
            </div>
          </div>

        </div>

        <div id="kpi-financial" style="display:none">
          <div id="kpi-financial-header">
            <span class="kpi-section-title">Financial</span>
            <button id="kpi-fin-cfg-btn" class="kpi-cfg-btn" title="Configure financial analytics">⚙ Configure</button>
          </div>
          <div class="kpi-grid-financial">
            <div class="kpi-fin-card">
              <div class="kpi-fin-value" id="kpi-fin-oee">—</div>
              <div class="kpi-fin-label">Session OEE</div>
            </div>
            <div class="kpi-fin-card">
              <div class="kpi-fin-value" id="kpi-fin-cost-m3">—</div>
              <div class="kpi-fin-label">Avg €/m³</div>
            </div>
            <div class="kpi-fin-card">
              <div class="kpi-fin-value" id="kpi-fin-risk">—</div>
              <div class="kpi-fin-label">Risk score</div>
            </div>
            <div class="kpi-fin-card">
              <div class="kpi-fin-value" id="kpi-fin-total">—</div>
              <div class="kpi-fin-label">Session cost</div>
            </div>
          </div>
        </div>

        <div id="kpi-footer">
          <span class="kpi-meta">Updates every 5s · Based on last 3 minutes of data</span>
        </div>

      </div>
    `;

    document.body.appendChild(el);
    this._overlay = el;

    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('visible')) this.close();
    });
    document.getElementById('kpi-close').addEventListener('click', () => this.close());
    document.getElementById('kpi-fin-cfg-btn').addEventListener('click', () => {
      this.close();
      ConfigModal.openAtSection('config-financial');
    });
  },

  _update(kpis) {
    if (!kpis) return;

    // Throughput
    const tp = document.getElementById('kpi-throughput');
    if (tp) tp.textContent = `${kpis.throughput}`;

    const fa = document.getElementById('kpi-flow-avg');
    if (fa) fa.textContent = `avg ${kpis.avgInletFlow} m³/h`;

    // Chlorination efficiency
    const ce = document.getElementById('kpi-chlorination-eff');
    if (ce) {
      ce.textContent  = `${kpis.chlorinationEff}%`;
      ce.style.color  = kpis.chlorinationEff >= 90
        ? 'var(--green)'
        : kpis.chlorinationEff >= 70
          ? 'var(--amber)'
          : 'var(--red)';
    }

    // Normal operation %
    const tn = document.getElementById('kpi-time-normal');
    if (tn) {
      tn.textContent = `${kpis.timeNormal}%`;
      tn.style.color = kpis.timeNormal >= 80
        ? 'var(--green)'
        : kpis.timeNormal >= 60
          ? 'var(--amber)'
          : 'var(--red)';
    }

    // Barra de estado operacional
    const barNormal  = document.getElementById('kpi-bar-normal');
    const barWarning = document.getElementById('kpi-bar-warning');
    const barDanger  = document.getElementById('kpi-bar-danger');
    if (barNormal)  barNormal.style.width  = `${kpis.timeNormal}%`;
    if (barWarning) barWarning.style.width = `${kpis.timeInWarning}%`;
    if (barDanger)  barDanger.style.width  = `${kpis.timeInDanger}%`;

    // Leyenda
    const ln = document.getElementById('kpi-legend-normal');
    const lw = document.getElementById('kpi-legend-warning');
    const ld = document.getElementById('kpi-legend-danger');
    if (ln) ln.textContent = `${kpis.timeNormal}%`;
    if (lw) lw.textContent = `${kpis.timeInWarning}%`;
    if (ld) ld.textContent = `${kpis.timeInDanger}%`;

    // Stats secundarios
    const bw = document.getElementById('kpi-backwash');
    if (bw) bw.textContent = kpis.backwashCount;

    const al = document.getElementById('kpi-alerts');
    if (al) {
      al.textContent = kpis.alertsTriggered;
      al.style.color = kpis.alertsTriggered > 0 ? 'var(--amber)' : 'var(--text0)';
    }

    const ck = document.getElementById('kpi-chlorine-kg');
    if (ck) ck.textContent = `${kpis.chlorineKg}`;

    const sm = document.getElementById('kpi-samples');
    if (sm) sm.textContent = kpis.samplesInWindow;

    // Session duration en el header
    const sl = document.getElementById('kpi-session-label');
    if (sl) sl.textContent = `Session: ${this._formatDuration(kpis.sessionDuration)}`;

    // ── Financial section ──────────────────────────────────────────────────
    const fcfg = FinancialConfig.get();
    const anyFin = fcfg.oee.enabled || fcfg.costPerUnit.enabled || fcfg.economicImpact.enabled;
    const finSection = document.getElementById('kpi-financial');
    if (finSection) finSection.style.display = anyFin ? '' : 'none';

    if (anyFin) {
      const oeeEl = document.getElementById('kpi-fin-oee');
      if (oeeEl && fcfg.oee.enabled) {
        const pct = (kpis.sessionOEE * 100).toFixed(1);
        oeeEl.textContent = `${pct}%`;
        oeeEl.style.color = kpis.sessionOEE >= 0.85 ? 'var(--green)'
          : kpis.sessionOEE >= 0.65 ? 'var(--amber)' : 'var(--red)';
      } else if (oeeEl) { oeeEl.textContent = '—'; oeeEl.style.color = ''; }

      const costEl = document.getElementById('kpi-fin-cost-m3');
      if (costEl && fcfg.costPerUnit.enabled) {
        costEl.textContent = `€${kpis.avgCostPerM3.toFixed(4)}`;
        costEl.style.color = 'var(--text0)';
      } else if (costEl) { costEl.textContent = '—'; costEl.style.color = ''; }

      const riskEl = document.getElementById('kpi-fin-risk');
      if (riskEl && fcfg.economicImpact.enabled) {
        riskEl.textContent = `€${kpis.financialRiskScore.toFixed(2)}`;
        riskEl.style.color = kpis.financialRiskScore === 0 ? 'var(--green)'
          : kpis.financialRiskScore < 50 ? 'var(--amber)' : 'var(--red)';
      } else if (riskEl) { riskEl.textContent = '—'; riskEl.style.color = ''; }

      const totalEl = document.getElementById('kpi-fin-total');
      if (totalEl && fcfg.costPerUnit.enabled) {
        totalEl.textContent = `€${kpis.sessionCostTotal.toFixed(2)}`;
        totalEl.style.color = 'var(--text0)';
      } else if (totalEl) { totalEl.textContent = '—'; totalEl.style.color = ''; }
    }
  },

  _injectStyles() {
    if (document.getElementById('kpi-fin-styles')) return;
    const style = document.createElement('style');
    style.id = 'kpi-fin-styles';
    style.textContent = `
#kpi-financial {
  border-top: 1px solid var(--line);
  padding: 10px 16px 8px;
}
#kpi-financial-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.kpi-section-title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px; font-weight: 600; color: var(--text2);
  text-transform: uppercase; letter-spacing: 0.08em;
}
.kpi-cfg-btn {
  background: var(--bg3); border: 1px solid var(--line2);
  color: var(--text2); border-radius: 3px; padding: 2px 7px;
  font-family: 'IBM Plex Sans', sans-serif; font-size: 8px;
  cursor: pointer; transition: color 0.12s;
}
.kpi-cfg-btn:hover { color: var(--text0); }
.kpi-grid-financial {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.kpi-fin-card {
  background: var(--bg2); border: 1px solid var(--line);
  border-radius: 4px; padding: 6px 10px;
}
.kpi-fin-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px; font-weight: 600; color: var(--text0);
  line-height: 1.2;
}
.kpi-fin-label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 8px; color: var(--text2); margin-top: 2px;
}
    `;
    document.head.appendChild(style);
  },

  _formatDuration(seconds) {
    if (seconds < 60)   return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  },

  destroy() {
    if (this._handler) {
      EventBus.off(EVENTS.KPIS_UPDATED, this._handler);
      this._handler = null;
    }
    this._overlay?.remove();
    this._overlay = null;
  },
};

export default KPIPanel;