/**
 * ReportSections.js — Pure functions that render each section to a jsPDF document.
 *
 * Convention:
 *   Each exported function receives (doc, data, config, y) and returns the new cursor Y.
 *   "doc"    — jsPDF instance
 *   "data"   — snapshot object from ReportEngine.getReportDataSnapshot()
 *   "config" — ReportConfig.get()
 *   "y"      — current vertical cursor position in mm
 *
 * A4 dimensions: 210 × 297 mm. Margins: top 18, right 16, bottom 18, left 16.
 * Usable width: 178mm. Page break threshold: 279mm (297 - 18).
 */

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_H    = 297;
const PAGE_W    = 210;
const MARGIN_L  = 16;
const MARGIN_R  = 16;
const MARGIN_B  = 18;
const USABLE_W  = PAGE_W - MARGIN_L - MARGIN_R;
const BREAK_Y   = PAGE_H - MARGIN_B - 2;

const CLR = {
  bodyText:  [30,  41,  59],   // #1e293b
  secondary: [100, 116, 139],  // #64748b
  muted:     [148, 163, 184],  // #94a3b8
  cardBg:    [248, 250, 252],  // #f8fafc
  border:    [226, 232, 240],  // #e2e8f0
  headerBg:  [15,  23,  42],   // #0f172a
  success:   [22,  163, 74],   // #16a34a
  warning:   [217, 119, 6],    // #d97706
  danger:    [220, 38,  38],   // #dc2626
  blue:      [2,   132, 199],  // #0284c7
  white:     [255, 255, 255],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : CLR.headerBg;
}

function safeY(doc, y, needed = 20) {
  if (y + needed > BREAK_Y) {
    doc.addPage();
    return 20;
  }
  return y;
}

function setFont(doc, style, size, color = CLR.bodyText) {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function drawRect(doc, x, y, w, h, fillColor, strokeColor, strokeWidth = 0.3) {
  if (fillColor) {
    doc.setFillColor(...fillColor);
    if (strokeColor) {
      doc.setDrawColor(...strokeColor);
      doc.setLineWidth(strokeWidth);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
    } else {
      doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
    }
  } else if (strokeColor) {
    doc.setDrawColor(...strokeColor);
    doc.setLineWidth(strokeWidth);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'D');
  }
}

function drawHLine(doc, x1, x2, y, color = CLR.border, width = 0.3) {
  doc.setDrawColor(...color);
  doc.setLineWidth(width);
  doc.line(x1, y, x2, y);
}

function statusColor(status) {
  if (status === 'danger')  return CLR.danger;
  if (status === 'warning') return CLR.warning;
  return CLR.success;
}

function statusLabel(status) {
  if (status === 'danger')  return 'CRITICAL';
  if (status === 'warning') return 'WARNING';
  return 'NORMAL';
}

function badgeLabel(activeAlerts) {
  if (!activeAlerts || activeAlerts.length === 0) return { text: 'ALL CLEAR',       color: CLR.success };
  const hasDanger = activeAlerts.some(a => a.severity === 'danger');
  if (hasDanger) return { text: 'CRITICAL ALERTS', color: CLR.danger };
  return           { text: 'WARNINGS ACTIVE',  color: CLR.warning };
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function trendArrow(direction) {
  if (direction === 'rising')  return '[+]';
  if (direction === 'falling') return '[-]';
  return '[~]';
}

function _sanitize(text) {
  if (text === null || text === undefined) return '\u2014';
  return String(text)
    .replace(/\u03c3/g, 'SD')
    .replace(/\u03bc/g, 'avg')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u00b0/g, 'deg')
    .replace(/[^\x00-\xFF]/g, '?');
}

function _truncate(doc, text, maxMm) {
  if (!text) return '\u2014';
  const safe = _sanitize(text);
  if (doc.getTextWidth(safe) <= maxMm) return safe;
  let s = safe;
  while (s.length > 1 && doc.getTextWidth(s + '...') > maxMm) {
    s = s.slice(0, -1);
  }
  return s + '...';
}

function getSensorStatus(sensorCfg, value) {
  if (value === null || value === undefined) return 'normal';
  if (value < sensorCfg.danger.low  || value > sensorCfg.danger.high)  return 'danger';
  if (value < sensorCfg.warning.low || value > sensorCfg.warning.high) return 'warning';
  return 'normal';
}

// ── Universal Header ─────────────────────────────────────────────────────────

export function renderHeader(doc, data, config, headerH = 32) {
  const branding     = config.branding;
  const primaryColor = hexToRgb(branding.primaryColor || '#1a4a7a');
  const accentColor  = hexToRgb(branding.accentColor  || '#0ea5e9');

  // Background rect
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, PAGE_W, headerH, 'F');

  let textX = MARGIN_L;

  // Logo
  if (branding.companyLogo) {
    try {
      const ext = branding.companyLogo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(branding.companyLogo, ext, 8, 4, 24, 24);
      textX = 36;
    } catch {}
  }

  // Company name
  setFont(doc, 'bold', 11, CLR.white);
  doc.text(branding.companyName || 'Water Operations Co.', textX, 13);

  // Report title (from data)
  setFont(doc, 'normal', 9, [200, 215, 230]);
  doc.text(data.reportTitle || 'Plant Status Report', textX, 20);

  // Plant info
  setFont(doc, 'normal', 8, CLR.muted);
  const plantInfo = [branding.plantName, branding.plantId, branding.plantLocation].filter(Boolean).join(' · ');
  doc.text(plantInfo, textX, 27);

  // Date right-aligned
  setFont(doc, 'normal', 8, CLR.muted);
  const dateStr = fmtDate(data.generatedAt);
  doc.text(dateStr, PAGE_W - MARGIN_R, 13, { align: 'right' });

  // Status badge
  const badge = badgeLabel(data.activeAlerts);
  const badgeW = 47, badgeH = 8;
  const badgeX = PAGE_W - MARGIN_R - badgeW;
  const badgeY = 17;
  doc.setFillColor(...badge.color);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
  setFont(doc, 'bold', 7, CLR.white);
  doc.text(badge.text, badgeX + badgeW / 2, badgeY + 5.5, { align: 'center' });

  return headerH + 4;
}

// ── Universal Footer ─────────────────────────────────────────────────────────

export function renderFooter(doc, config, pageNum, totalPages) {
  const branding = config.branding;
  const footerY  = PAGE_H - 12;

  doc.setFillColor(...CLR.cardBg);
  doc.rect(0, footerY, PAGE_W, 12, 'F');
  drawHLine(doc, 0, PAGE_W, footerY, CLR.border, 0.3);

  setFont(doc, 'normal', 7, CLR.muted);
  doc.text(branding.footerText || 'Confidential — Internal Use Only', MARGIN_L, footerY + 7);

  const versionText = `WTP Digital Twin · EVENT_CONTRACT v5`;
  doc.text(versionText, PAGE_W / 2, footerY + 7, { align: 'center' });

  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN_R, footerY + 7, { align: 'right' });
}

// ── Section Label ────────────────────────────────────────────────────────────

function renderSectionLabel(doc, text, y) {
  setFont(doc, 'bold', 11, CLR.bodyText);
  doc.text(text, MARGIN_L, y);
  drawHLine(doc, MARGIN_L, PAGE_W - MARGIN_R, y + 2, CLR.border, 0.3);
  return y + 8;
}

// ── KPI Row ──────────────────────────────────────────────────────────────────

export function renderKPIRow(doc, data, config, y, cardH = 22) {
  const kpis        = data.kpis || {};
  const accentColor = hexToRgb(config.branding.accentColor || '#0ea5e9');

  const cards = [
    {
      label: 'THROUGHPUT',
      value: kpis.throughput !== undefined ? kpis.throughput.toFixed(1) : '—',
      unit:  'm³',
      color: CLR.blue,
    },
    {
      label: 'OEE',
      value: kpis.oee !== undefined ? `${kpis.oee.toFixed(1)}%` : (kpis.timeNormal !== undefined ? `${kpis.timeNormal.toFixed(1)}%` : '—'),
      unit:  '',
      color: (kpis.oee || kpis.timeNormal || 100) < 65 ? CLR.danger : CLR.success,
    },
    {
      label: 'ALERTS',
      value: kpis.alertsTriggered !== undefined ? String(kpis.alertsTriggered) : '—',
      unit:  'total',
      color: (kpis.alertsTriggered || 0) > 0 ? CLR.warning : CLR.success,
    },
    {
      label: 'SESSION',
      value: kpis.sessionDuration !== undefined ? fmtDuration(kpis.sessionDuration * 1000) : '—',
      unit:  '',
      color: CLR.bodyText,
    },
  ];

  const cardW = 42;
  const gap   = (USABLE_W - cardW * 4) / 3;
  let   cx    = MARGIN_L;

  cards.forEach(card => {
    drawRect(doc, cx, y, cardW, cardH, CLR.cardBg, CLR.border, 0.3);

    // Accent top bar
    doc.setFillColor(...accentColor);
    doc.rect(cx, y, cardW, 1.5, 'F');

    // Label
    setFont(doc, 'normal', 6.5, CLR.secondary);
    doc.text(card.label, cx + cardW / 2, y + 7, { align: 'center' });

    // Value
    setFont(doc, 'bold', 16, card.color);
    doc.text(card.value, cx + cardW / 2, y + 17, { align: 'center' });

    // Unit
    if (card.unit) {
      setFont(doc, 'normal', 7, CLR.secondary);
      // Approximate text width to place unit inline
      const valW = doc.getTextWidth(card.value);
      doc.text(card.unit, cx + cardW / 2 + valW / 2 + 1, y + 17);
    }

    cx += cardW + gap;
  });

  return y + cardH + 4;
}

// ── Sensor Status Table ──────────────────────────────────────────────────────

export function renderSensorTable(doc, data, config, y) {
  const sensors  = data.sensors || [];
  const readings = data.readings || {};
  const history  = data.history  || [];

  y = safeY(doc, y, 40);
  y = renderSectionLabel(doc, 'Sensor Status', y);

  // Table header
  const tableX = MARGIN_L;
  const colW   = [46, 30, 25, 22, 55];  // Sensor | Value | Status | Trend | Min/Avg/Max
  const rowH   = 6.5;
  const headerH = 6;

  doc.setFillColor(...CLR.headerBg);
  doc.rect(tableX, y, USABLE_W, headerH, 'F');

  const headers = ['SENSOR', 'CURRENT VALUE', 'STATUS', 'TREND', 'MIN / AVG / MAX'];
  const colX    = [22, 68, 102, 128, 152];
  setFont(doc, 'bold', 7, CLR.white);
  headers.forEach((h, i) => doc.text(h, colX[i], y + 4.5));
  y += headerH;

  sensors.forEach((sensor, idx) => {
    y = safeY(doc, y, rowH + 2);

    const value  = readings[sensor.id];
    const status = getSensorStatus(sensor, value);
    const color  = statusColor(status);

    // Alternating row background
    if (idx % 2 === 1) {
      doc.setFillColor(...CLR.cardBg);
      doc.rect(tableX, y, USABLE_W, rowH, 'F');
    }

    // Sensor name
    setFont(doc, 'normal', 8, CLR.bodyText);
    doc.text(sensor.label || sensor.id, colX[0], y + 4.5);

    // Value
    const valStr = value !== undefined ? `${value.toFixed(2)} ${sensor.unit}` : '—';
    setFont(doc, 'bold', 8, status !== 'normal' ? color : CLR.bodyText);
    doc.text(valStr, colX[1], y + 4.5);

    // Status badge
    const badgeX2 = colX[2] - 1;
    const badgeW2 = 20, badgeH2 = 4.5;
    doc.setFillColor(...color);
    doc.roundedRect(badgeX2, y + 1, badgeW2, badgeH2, 1.5, 1.5, 'F');
    setFont(doc, 'bold', 6.5, CLR.white);
    doc.text(statusLabel(status), badgeX2 + badgeW2 / 2, y + 4.5, { align: 'center' });

    // Trend arrow
    const histForSensor = history.slice(-30).map(h => h.readings?.[sensor.id]).filter(v => typeof v === 'number');
    let direction = 'stable';
    if (histForSensor.length >= 3) {
      const last  = histForSensor[histForSensor.length - 1];
      const first = histForSensor[0];
      const delta = last - first;
      if      (Math.abs(delta) < 0.5) direction = 'stable';
      else if (delta > 0)             direction = 'rising';
      else                            direction = 'falling';
    }
    const arrow      = trendArrow(direction);
    const arrowColor = direction === 'stable' ? CLR.secondary :
                       direction === 'rising'  ? CLR.warning   : CLR.blue;
    setFont(doc, 'bold', 10, arrowColor);
    doc.text(arrow, colX[3], y + 5);

    // Min/Avg/Max
    if (histForSensor.length > 0) {
      const min = Math.min(...histForSensor).toFixed(1);
      const max = Math.max(...histForSensor).toFixed(1);
      const avg = (histForSensor.reduce((a, b) => a + b, 0) / histForSensor.length).toFixed(1);
      setFont(doc, 'normal', 7, CLR.secondary);
      doc.text(`${min} / ${avg} / ${max}`, colX[4], y + 4.5);
    } else {
      setFont(doc, 'normal', 7, CLR.secondary);
      doc.text('— / — / —', colX[4], y + 4.5);
    }

    y += rowH;
  });

  // Bottom border
  drawHLine(doc, tableX, tableX + USABLE_W, y, CLR.border, 0.3);
  return y + 4;
}

// ── Active Alerts Table ──────────────────────────────────────────────────────

export function renderActiveAlertsTable(doc, data, config, y) {
  const alerts = data.activeAlerts || [];

  y = safeY(doc, y, 30);
  y = renderSectionLabel(doc, 'Active Alerts', y);

  if (alerts.length === 0) {
    drawRect(doc, MARGIN_L, y, USABLE_W, 12, [240, 253, 244], [187, 247, 208], 0.5);
    setFont(doc, 'normal', 9, [22, 163, 74]);
    doc.text('No active alerts at time of report generation.', MARGIN_L + USABLE_W / 2, y + 8, { align: 'center' });
    return y + 16;
  }

  // Header
  const colX  = [22, 68, 118, 155];
  const rowH  = 6;
  const headerH = 6;

  doc.setFillColor(...CLR.headerBg);
  doc.rect(MARGIN_L, y, USABLE_W, headerH, 'F');
  setFont(doc, 'bold', 7, CLR.white);
  ['SENSOR', 'RULE', 'ELAPSED', 'SEVERITY'].forEach((h, i) => doc.text(h, colX[i], y + 4.5));
  y += headerH;

  alerts.forEach((alert, idx) => {
    y = safeY(doc, y, rowH + 2);
    if (idx % 2 === 1) {
      doc.setFillColor(...CLR.cardBg);
      doc.rect(MARGIN_L, y, USABLE_W, rowH, 'F');
    }

    const elapsed = fmtDuration(Date.now() - (alert.timestamp || 0));
    const sevColor = alert.severity === 'danger' ? CLR.danger : CLR.warning;

    setFont(doc, 'normal', 8, CLR.bodyText);
    doc.text(_truncate(doc, (alert.sensorIds || []).join(', '), 43), colX[0], y + 4.2);
    doc.text(_truncate(doc, alert.message || alert.id, 47), colX[1], y + 4.2);
    doc.text(elapsed, colX[2], y + 4.2);

    // Severity badge
    doc.setFillColor(...sevColor);
    doc.roundedRect(colX[3] - 1, y + 0.8, 22, 4.5, 1.5, 1.5, 'F');
    setFont(doc, 'bold', 6.5, CLR.white);
    doc.text(alert.severity?.toUpperCase() || '—', colX[3] + 10, y + 4.2, { align: 'center' });

    y += rowH;
  });

  drawHLine(doc, MARGIN_L, MARGIN_L + USABLE_W, y, CLR.border, 0.3);
  return y + 4;
}

// ── Resolved Alerts Table ────────────────────────────────────────────────────

export function renderResolvedAlertsTable(doc, data, config, y) {
  const resolved = data.resolvedAlerts || [];

  y = safeY(doc, y, 30);
  y = renderSectionLabel(doc, 'Resolved Alerts (last 8h)', y);

  if (resolved.length === 0) {
    drawRect(doc, MARGIN_L, y, USABLE_W, 12, [240, 253, 244], [187, 247, 208], 0.5);
    setFont(doc, 'normal', 9, [22, 163, 74]);
    doc.text('No alerts resolved in the report window.', MARGIN_L + USABLE_W / 2, y + 8, { align: 'center' });
    return y + 16;
  }

  const colX   = [22, 68, 108, 138, 165];
  const rowH   = 6;
  const headerH = 6;

  doc.setFillColor(...[30, 41, 59]);
  doc.rect(MARGIN_L, y, USABLE_W, headerH, 'F');
  setFont(doc, 'bold', 7, CLR.white);
  ['SENSOR', 'RULE', 'STARTED', 'RESOLVED', 'DURATION'].forEach((h, i) => doc.text(h, colX[i], y + 4.5));
  y += headerH;

  resolved.slice(0, 15).forEach((alert, idx) => {
    y = safeY(doc, y, rowH + 2);
    if (idx % 2 === 1) {
      doc.setFillColor(...CLR.cardBg);
      doc.rect(MARGIN_L, y, USABLE_W, rowH, 'F');
    }

    const duration = fmtDuration((alert.resolvedAt || 0) - (alert.timestamp || 0));

    setFont(doc, 'normal', 7.5, CLR.bodyText);
    doc.text((alert.sensorIds || []).join(', '), colX[0], y + 4.2);
    doc.text(_truncate(doc, alert.message || alert.id, 37), colX[1], y + 4.2);
    setFont(doc, 'normal', 7, CLR.secondary);
    doc.text(fmtTime(alert.timestamp),  colX[2], y + 4.2);
    doc.text(fmtTime(alert.resolvedAt), colX[3], y + 4.2);
    setFont(doc, 'normal', 7.5, CLR.bodyText);
    doc.text(duration, colX[4], y + 4.2);

    y += rowH;
  });

  drawHLine(doc, MARGIN_L, MARGIN_L + USABLE_W, y, CLR.border, 0.3);
  return y + 4;
}

// ── Operator Strip (Shift Handover) ──────────────────────────────────────────

export function renderOperatorStrip(doc, data, config, y) {
  const author   = config.branding.reportAuthor || 'Operator';
  drawRect(doc, MARGIN_L, y, USABLE_W, 10, CLR.cardBg, null);

  setFont(doc, 'normal', 7, CLR.secondary);
  doc.text('OUTGOING OPERATOR', 22, y + 7);
  setFont(doc, 'bold', 9, CLR.bodyText);
  doc.text(author, 75, y + 7);
  setFont(doc, 'normal', 7, CLR.secondary);
  doc.text('INCOMING OPERATOR', 110, y + 7);
  setFont(doc, 'bold', 9, CLR.bodyText);
  doc.text('—', 155, y + 7);

  return y + 14;
}

// ── Signature Line ────────────────────────────────────────────────────────────

export function renderSignatureLine(doc, data, config, y) {
  y = safeY(doc, y, 20);
  y += 6;

  drawHLine(doc, MARGIN_L, MARGIN_L + 81, y + 10, CLR.bodyText, 0.5);
  drawHLine(doc, MARGIN_L + 97, PAGE_W - MARGIN_R, y + 10, CLR.bodyText, 0.5);

  setFont(doc, 'normal', 8, CLR.secondary);
  doc.text('Outgoing Operator Signature', MARGIN_L + 40, y + 15, { align: 'center' });
  doc.text('Incoming Operator Signature', MARGIN_L + 97 + 49, y + 15, { align: 'center' });

  return y + 22;
}

// ── Incident Summary Bar ──────────────────────────────────────────────────────

export function renderIncidentSummaryBar(doc, data, config, y) {
  const firstAlert = (data.activeAlerts || []).concat(data.resolvedAlerts || [])
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))[0];
  const startTs = firstAlert?.timestamp || data.generatedAt;
  const endTs   = data.generatedAt;
  const duration = fmtDuration(endTs - startTs);
  const sensorCount = new Set(
    (data.activeAlerts || []).concat(data.resolvedAlerts || [])
      .flatMap(a => a.sensorIds || [])
  ).size;

  drawRect(doc, MARGIN_L, y, USABLE_W, 16, [255, 247, 237], [254, 215, 170], 0.5);

  setFont(doc, 'normal', 7, [154, 52, 18]);
  doc.text('INCIDENT WINDOW', 22, y + 5);
  setFont(doc, 'bold', 9, [124, 45, 18]);
  doc.text(`${fmtDate(startTs)} → ${fmtTime(endTs)}`, 22, y + 12);

  setFont(doc, 'normal', 7, [154, 52, 18]);
  doc.text('TOTAL DURATION', 106, y + 5);
  setFont(doc, 'bold', 9, [124, 45, 18]);
  doc.text(duration, 106, y + 12);

  setFont(doc, 'normal', 7, [154, 52, 18]);
  doc.text('SENSORS INVOLVED', 156, y + 5);
  setFont(doc, 'bold', 9, [124, 45, 18]);
  doc.text(String(sensorCount), 156, y + 12);

  return y + 20;
}

// ── Root Cause Section (Incident Report) ─────────────────────────────────────

export function renderRootCauseSection(doc, data, config, y) {
  y = safeY(doc, y, 26);
  y = renderSectionLabel(doc, 'Root Cause Analysis', y);

  const text = data.rootCause || 'No root cause notes provided.';
  drawRect(doc, MARGIN_L, y, USABLE_W, 16, CLR.cardBg, CLR.border, 0.5);

  setFont(doc, 'italic', 8, CLR.secondary);
  doc.text('Operator notes:', MARGIN_L + 4, y + 5);

  setFont(doc, 'normal', 8, CLR.bodyText);
  const lines = doc.splitTextToSize(text, USABLE_W - 8);
  doc.text(lines.slice(0, 2), MARGIN_L + 4, y + 11);

  return y + 20;
}

// ── Alert Timeline (Incident Report) ─────────────────────────────────────────

export function renderAlertTimeline(doc, data, config, y) {
  const allAlerts = [...(data.activeAlerts || []), ...(data.resolvedAlerts || [])]
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (!allAlerts.length) return y;

  y = safeY(doc, y, 40);
  y = renderSectionLabel(doc, 'Alert Timeline', y);

  const timelineX = 26;

  // Vertical axis line
  drawHLine(doc, timelineX, timelineX, y, CLR.border, 0.8);

  allAlerts.forEach(alert => {
    y = safeY(doc, y, 16);

    const circleColor = alert.active ? (alert.severity === 'danger' ? CLR.danger : CLR.warning) : CLR.success;

    // Timeline circle
    doc.setFillColor(...circleColor);
    doc.circle(timelineX, y + 3, 2, 'F');

    // Timestamp
    setFont(doc, 'bold', 8, CLR.bodyText);
    doc.text(fmtTime(alert.timestamp), timelineX + 5, y + 4);

    // Event description
    setFont(doc, 'normal', 8, CLR.bodyText);
    const msg = _truncate(doc, alert.message || alert.id, 90);
    doc.text(msg, timelineX + 40, y + 4);

    // Rule detail
    setFont(doc, 'italic', 7, CLR.muted);
    const detail = (alert.sensorIds || []).join(', ') + (alert.active ? ' · ACTIVE' : ' · resolved');
    doc.text(detail, timelineX + 5, y + 9);

    y += 14;
  });

  return y + 4;
}

// ── Chart Grid (2-column layout) ─────────────────────────────────────────────

export async function renderChartGrid(doc, data, config, y, chartImages) {
  if (!chartImages || chartImages.length === 0) return y;

  y = safeY(doc, y, 50);
  y = renderSectionLabel(doc, 'Sensor Trend Charts', y);

  const chartW = 84;
  const chartH = 44;
  const gap    = 10;

  for (let i = 0; i < chartImages.length; i += 2) {
    y = safeY(doc, y, chartH + 6);

    const leftImg  = chartImages[i];
    const rightImg = chartImages[i + 1];

    const drawChart = (img, x, cy) => {
      drawRect(doc, x, cy, chartW, chartH, CLR.cardBg, CLR.border, 0.5);

      if (img) {
        setFont(doc, 'bold', 8, CLR.bodyText);
        doc.text(img.label || '—', x + 3, cy + 5);
        setFont(doc, 'normal', 7, CLR.secondary);
        doc.text(img.unit || '', x + 3, cy + 10);

        if (img.dataUrl) {
          try {
            doc.addImage(img.dataUrl, 'PNG', x + 2, cy + 13, chartW - 4, 28);
          } catch {}
        }
      }
    };

    drawChart(leftImg,  MARGIN_L,               y);
    if (rightImg) drawChart(rightImg, MARGIN_L + chartW + gap, y);

    y += chartH + 4;
  }

  return y + 2;
}

// ── Executive KPI Row (taller, with comparison) ───────────────────────────────

export function renderExecutiveKPIRow(doc, data, config, y) {
  const kpis        = data.kpis || {};
  const accentColor = hexToRgb(config.branding.accentColor || '#0ea5e9');

  const cardW = 42;
  const cardH = 28;
  const gap   = (USABLE_W - cardW * 4) / 3;

  const cards = [
    { label: 'THROUGHPUT',   value: kpis.throughput  !== undefined ? kpis.throughput.toFixed(0) : '—', unit: 'm³',    color: CLR.blue,    trend: null },
    { label: 'NORMAL OPS',   value: kpis.timeNormal  !== undefined ? `${kpis.timeNormal.toFixed(1)}%` : '—', unit: '', color: (kpis.timeNormal || 100) < 80 ? CLR.warning : CLR.success, trend: null },
    { label: 'ALERTS',       value: kpis.alertsTriggered !== undefined ? String(kpis.alertsTriggered) : '—', unit: 'total', color: (kpis.alertsTriggered || 0) > 5 ? CLR.danger : CLR.success, trend: null },
    { label: 'SESSION',      value: kpis.sessionDuration !== undefined ? fmtDuration(kpis.sessionDuration * 1000) : '—', unit: '', color: CLR.bodyText, trend: null },
  ];

  let cx = MARGIN_L;
  cards.forEach(card => {
    drawRect(doc, cx, y, cardW, cardH, CLR.cardBg, CLR.border, 0.3);

    // Accent top bar
    doc.setFillColor(...accentColor);
    doc.rect(cx, y, cardW, 1.5, 'F');

    // Label
    setFont(doc, 'normal', 6.5, CLR.secondary);
    doc.text(card.label, cx + cardW / 2, y + 9, { align: 'center' });

    // Value
    setFont(doc, 'bold', 15, card.color);
    doc.text(card.value, cx + cardW / 2, y + 20, { align: 'center' });

    if (card.unit) {
      setFont(doc, 'normal', 7, CLR.secondary);
      const valW = doc.getTextWidth(card.value);
      doc.text(card.unit, cx + cardW / 2 + valW / 2 + 1, y + 20);
    }

    cx += cardW + gap;
  });

  return y + cardH + 4;
}

// ── Top Alerts Table (Executive Summary) ─────────────────────────────────────

export function renderTopAlertsTable(doc, data, config, y) {
  const resolved = data.resolvedAlerts || [];
  const active   = data.activeAlerts   || [];
  const all      = [...active, ...resolved];

  if (!all.length) return y;

  // Aggregate by rule id/message
  const freq = {};
  all.forEach(a => {
    const key = a.id || a.message || '?';
    if (!freq[key]) freq[key] = { alert: a, count: 0, totalDuration: 0 };
    freq[key].count++;
    if (a.resolvedAt && a.timestamp) freq[key].totalDuration += a.resolvedAt - a.timestamp;
  });

  const top5 = Object.values(freq)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  y = safeY(doc, y, 40);
  y = renderSectionLabel(doc, 'Top Alert Rules', y);

  const colX   = [22, 80, 120, 145, 170];
  const rowH   = 5.5;
  const headerH = 6;

  doc.setFillColor(...[30, 41, 59]);
  doc.rect(MARGIN_L, y, USABLE_W, headerH, 'F');
  setFont(doc, 'bold', 7, CLR.white);
  ['RULE NAME', 'SENSOR', 'OCCURRENCES', 'AVG DURATION', 'SEVERITY'].forEach((h, i) => doc.text(h, colX[i], y + 4.5));
  y += headerH;

  top5.forEach((item, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(...CLR.cardBg);
      doc.rect(MARGIN_L, y, USABLE_W, rowH, 'F');
    }

    const a        = item.alert;
    const avgDur   = item.count > 0 ? fmtDuration(item.totalDuration / item.count) : '—';
    const sevColor = a.severity === 'danger' ? CLR.danger : CLR.warning;

    setFont(doc, 'normal', 7.5, CLR.bodyText);
    doc.text((a.message || a.id || '—').substring(0, 30), colX[0], y + 4);
    doc.text((a.sensorIds || []).join(', ').substring(0, 20), colX[1], y + 4);
    setFont(doc, 'bold', 8, CLR.bodyText);
    doc.text(String(item.count), colX[2], y + 4);
    setFont(doc, 'normal', 7.5, CLR.bodyText);
    doc.text(avgDur, colX[3], y + 4);

    doc.setFillColor(...sevColor);
    doc.roundedRect(colX[4] - 1, y + 0.5, 22, 4, 1.5, 1.5, 'F');
    setFont(doc, 'bold', 6.5, CLR.white);
    doc.text(a.severity?.toUpperCase() || '—', colX[4] + 10, y + 3.8, { align: 'center' });

    y += rowH;
  });

  drawHLine(doc, MARGIN_L, MARGIN_L + USABLE_W, y, CLR.border, 0.3);
  return y + 4;
}

// ── Financial Impact Card ─────────────────────────────────────────────────────

export function renderFinancialCard(doc, data, config, y) {
  const kpis = data.kpis || {};

  y = safeY(doc, y, 30);
  y = renderSectionLabel(doc, 'Financial Impact', y);

  const cardW = (USABLE_W - 8) / 2;

  const leftMetrics = [
    { label: 'Cost / m³',        value: kpis.costPerM3       !== undefined ? `€${kpis.costPerM3.toFixed(3)}`       : '—' },
    { label: 'Cost / unit',      value: kpis.costPerUnit      !== undefined ? `€${kpis.costPerUnit.toFixed(4)}`      : '—' },
    { label: 'Economic Impact',  value: kpis.economicImpact   !== undefined ? `€${kpis.economicImpact.toFixed(2)}`   : '—' },
  ];
  const rightMetrics = [
    { label: 'OEE',              value: kpis.oee              !== undefined ? `${kpis.oee.toFixed(1)}%`              : '—' },
    { label: 'Chlorination Eff.',value: kpis.chlorinationEff  !== undefined ? `${kpis.chlorinationEff.toFixed(1)}%`  : '—' },
    { label: 'Avg Inlet Flow',   value: kpis.avgInletFlow     !== undefined ? `${kpis.avgInletFlow.toFixed(1)} m³/h` : '—' },
  ];

  const drawCard = (metrics, x, cardY) => {
    drawRect(doc, x, cardY, cardW, 18, CLR.cardBg, CLR.border, 0.5);
    metrics.forEach((m, i) => {
      setFont(doc, 'normal', 7, CLR.secondary);
      doc.text(m.label, x + 4, cardY + 5 + i * 5);
      setFont(doc, 'bold', 8, CLR.bodyText);
      doc.text(m.value, x + cardW - 4, cardY + 5 + i * 5, { align: 'right' });
    });
  };

  drawCard(leftMetrics,  MARGIN_L,              y);
  drawCard(rightMetrics, MARGIN_L + cardW + 8,  y);

  return y + 22;
}

// ── Large chart (full-width, for Executive expanded view) ─────────────────────

export async function renderLargeChart(doc, data, config, y, imgEntry) {
  if (!imgEntry?.dataUrl) return y;

  y = safeY(doc, y, 70);

  const chartW = USABLE_W;
  const chartH = 60;

  drawRect(doc, MARGIN_L, y, chartW, chartH, CLR.cardBg, CLR.border, 0.5);

  setFont(doc, 'bold', 9, CLR.bodyText);
  doc.text(imgEntry.label || '—', MARGIN_L + 4, y + 6);
  setFont(doc, 'normal', 7.5, CLR.secondary);
  doc.text(imgEntry.unit || '', MARGIN_L + 4, y + 11);

  try {
    doc.addImage(imgEntry.dataUrl, 'PNG', MARGIN_L + 2, y + 14, chartW - 4, chartH - 16);
  } catch {}

  return y + chartH + 4;
}
