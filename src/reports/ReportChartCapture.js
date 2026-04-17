/**
 * ReportChartCapture.js — Captures SVG elements to PNG data URLs via html2canvas.
 *
 * Strategy:
 *   1. Clone the SVG to normalize fonts (no custom fonts — use Arial/Helvetica only).
 *   2. Append clone off-screen (fixed, top:-9999px) so html2canvas can measure it.
 *   3. Wait one animation frame for layout.
 *   4. Capture at scale:2 for retina quality.
 *   5. Remove clone.
 *
 * Returns a PNG data URL or null if capture fails (graceful degradation).
 */

import html2canvas from 'html2canvas';

/**
 * Captures an SVG element and returns a PNG data URL.
 *
 * @param {SVGElement|HTMLElement} svgEl   — the SVG or containing element
 * @param {{ width?: number, height?: number }} opts  — desired render dimensions in px
 * @returns {Promise<string|null>}  PNG data URL or null on failure
 */
export async function captureSvgToPng(svgEl, opts = {}) {
  if (!svgEl) return null;

  // Clone and normalize fonts so html2canvas doesn't try to load custom fonts
  const clone = svgEl.cloneNode(true);
  _normalizeFonts(clone);

  // Size the clone explicitly so html2canvas gets accurate dimensions
  const srcRect = svgEl.getBoundingClientRect();
  const w = opts.width  || srcRect.width  || 800;
  const h = opts.height || srcRect.height || 300;

  clone.style.cssText = `
    position: fixed;
    top: -9999px;
    left: -9999px;
    width: ${w}px;
    height: ${h}px;
    visibility: hidden;
    overflow: hidden;
  `;

  // SVG needs explicit width/height attributes for html2canvas
  if (clone.tagName && clone.tagName.toLowerCase() === 'svg') {
    clone.setAttribute('width',  w);
    clone.setAttribute('height', h);
  }

  document.body.appendChild(clone);

  // Wait for layout + one paint frame
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  try {
    const canvas = await html2canvas(clone, {
      scale:           2,
      useCORS:         false,
      allowTaint:      false,
      backgroundColor: '#f8fafc',
      width:           w,
      height:          h,
      logging:         false,
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[ReportChartCapture] html2canvas failed:', err);
    return null;
  } finally {
    document.body.removeChild(clone);
  }
}

/**
 * Builds a professional line chart directly on a canvas from time-series data.
 * Used as the primary chart path during report generation (panels are usually closed).
 *
 * Features:
 *   - Colored background zones: green (normal), amber (warning), red (danger)
 *   - Dashed threshold lines at warning.low / warning.high
 *   - Data line colored by state (green/amber/red per segment)
 *   - Y-axis labels (min, mid, max)
 *   - X-axis time labels (start / end)
 *   - Scale factor 2× for retina quality in PDFs
 *
 * @param {{ timestamp: number, value: number }[]} points
 * @param {{
 *   label:    string,
 *   unit:     string,
 *   normal:   { low: number, high: number },
 *   warning:  { low: number, high: number },
 *   danger:   { low: number, high: number },
 *   rangeMin: number,
 *   rangeMax: number,
 * }} meta
 * @param {{ width: number, height: number }} size
 * @returns {Promise<string|null>} PNG data URL (2× resolution) or null
 */
export async function buildFallbackChartPng(points, meta, size = { width: 600, height: 200 }) {
  if (!points || points.length < 2) return null;

  const values = points.map(p => p.value).filter(v => typeof v === 'number' && isFinite(v));
  if (values.length < 2) return null;

  const { width, height } = size;
  const SCALE = 2; // retina
  const PAD   = { top: 20, right: 16, bottom: 28, left: 46 };

  const canvas = document.createElement('canvas');
  canvas.width  = width  * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // ── Value / time ranges ──────────────────────────────────────────────────
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  // Visible range: use sensor rangeMin/rangeMax clamped to data extent with 10% padding
  const pad  = (dataMax - dataMin) * 0.10 || 1;
  const vMin = meta.rangeMin !== undefined
    ? Math.min(meta.rangeMin, dataMin - pad)
    : dataMin - pad;
  const vMax = meta.rangeMax !== undefined
    ? Math.max(meta.rangeMax, dataMax + pad)
    : dataMax + pad;
  const vRange = vMax - vMin || 1;

  const minT = points[0].timestamp;
  const maxT = points[points.length - 1].timestamp;
  const tRange = maxT - minT || 1;

  const chartW = width  - PAD.left - PAD.right;
  const chartH = height - PAD.top  - PAD.bottom;

  const toX = t => PAD.left + ((t - minT) / tRange) * chartW;
  const toY = v => PAD.top  + chartH - ((v - vMin) / vRange) * chartH;

  // Helper: clamp Y to chart area
  const clampY = y => Math.min(PAD.top + chartH, Math.max(PAD.top, y));

  // ── Background ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  // ── Zone bands (danger → warning → normal, bottom up) ───────────────────
  const drawBand = (lo, hi, color) => {
    const y1 = clampY(toY(hi));
    const y2 = clampY(toY(lo));
    if (y2 <= y1) return;
    ctx.fillStyle = color;
    ctx.fillRect(PAD.left, y1, chartW, y2 - y1);
  };

  // Danger zones (outside warning)
  if (meta.danger && meta.warning) {
    drawBand(meta.warning.high, vMax,          'rgba(220,38,38,0.08)');
    drawBand(vMin,              meta.warning.low, 'rgba(220,38,38,0.08)');
    // Warning zones (between warning and normal)
    if (meta.normal) {
      drawBand(meta.normal.high,  meta.warning.high, 'rgba(217,119,6,0.10)');
      drawBand(meta.warning.low,  meta.normal.low,   'rgba(217,119,6,0.10)');
      // Normal zone
      drawBand(meta.normal.low,   meta.normal.high,  'rgba(22,163,74,0.08)');
    }
  }

  // ── Grid lines (3 horizontal) ────────────────────────────────────────────
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth   = 0.5;
  for (let i = 0; i <= 3; i++) {
    const y = PAD.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.stroke();
  }

  // ── Threshold dashed lines ───────────────────────────────────────────────
  const drawDash = (v, color) => {
    if (v === undefined || v < vMin || v > vMax) return;
    const y = toY(v);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (meta.warning) {
    drawDash(meta.warning.high, '#d97706');
    drawDash(meta.warning.low,  '#d97706');
  }

  // ── Data line (colored by state per segment) ─────────────────────────────
  const stateColor = v => {
    if (!meta.danger || !meta.warning) return '#0284c7';
    if (v < meta.danger.low  || v > meta.danger.high)  return '#dc2626';
    if (v < meta.warning.low || v > meta.warning.high) return '#d97706';
    return '#16a34a';
  };

  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!isFinite(prev.value) || !isFinite(curr.value)) continue;
    ctx.strokeStyle = stateColor((prev.value + curr.value) / 2);
    ctx.beginPath();
    ctx.moveTo(toX(prev.timestamp), clampY(toY(prev.value)));
    ctx.lineTo(toX(curr.timestamp), clampY(toY(curr.value)));
    ctx.stroke();
  }

  // ── Chart border ─────────────────────────────────────────────────────────
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth   = 0.5;
  ctx.setLineDash([]);
  ctx.strokeRect(PAD.left, PAD.top, chartW, chartH);

  // ── Y-axis labels ─────────────────────────────────────────────────────────
  ctx.fillStyle  = '#94a3b8';
  ctx.font       = '9px Arial, Helvetica, sans-serif';
  ctx.textAlign  = 'right';
  ctx.textBaseline = 'middle';

  const yTicks = [vMin, vMin + vRange / 2, vMax];
  yTicks.forEach(v => {
    const y = clampY(toY(v));
    ctx.fillText(_fmt(v), PAD.left - 4, y);
  });

  // ── X-axis labels ─────────────────────────────────────────────────────────
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(_fmtTime(minT), PAD.left, PAD.top + chartH + 4);
  ctx.textAlign = 'right';
  ctx.fillText(_fmtTime(maxT), PAD.left + chartW, PAD.top + chartH + 4);

  // ── Sensor label ─────────────────────────────────────────────────────────
  ctx.fillStyle    = '#334155';
  ctx.font         = 'bold 9px Arial, Helvetica, sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${meta.label} (${meta.unit})`, PAD.left + 2, 4);

  // ── Current value annotation ──────────────────────────────────────────────
  const lastVal = values[values.length - 1];
  if (isFinite(lastVal)) {
    const lx = PAD.left + chartW;
    const ly = clampY(toY(lastVal));
    ctx.fillStyle = stateColor(lastVal);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle    = stateColor(lastVal);
    ctx.font         = 'bold 8px Arial, Helvetica, sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(_fmt(lastVal), lx - 6, ly);
  }

  return canvas.toDataURL('image/png');
}

function _fmt(v) {
  if (!isFinite(v)) return '—';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function _fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _normalizeFonts(el) {
  const SAFE_FONT = 'Arial, Helvetica, sans-serif';
  if (el.style) {
    el.style.fontFamily = SAFE_FONT;
  }
  el.querySelectorAll?.('[style]')?.forEach(child => {
    child.style.fontFamily = SAFE_FONT;
  });
  el.querySelectorAll?.('text,tspan')?.forEach(textEl => {
    textEl.setAttribute('font-family', SAFE_FONT);
  });
}
