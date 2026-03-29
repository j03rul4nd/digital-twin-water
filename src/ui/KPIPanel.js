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

const KPIPanel = {
  _overlay:  null,
  _handler:  null,
  _expanded: false,

  init() {
    this._build();

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