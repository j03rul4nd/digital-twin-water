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
 * Builds a minimal SVG line chart from raw time-series data when the
 * original SVG is not available in the DOM (e.g. MCP/headless mode).
 *
 * @param {{ timestamp: number, value: number }[]} points
 * @param {{ label: string, unit: string, normalLow: number, normalHigh: number }} meta
 * @param {{ width: number, height: number }} size
 * @returns {Promise<string|null>} PNG data URL
 */
export async function buildFallbackChartPng(points, meta, size = { width: 600, height: 200 }) {
  if (!points || points.length < 2) return null;

  const { width, height } = size;
  const PAD = { top: 16, right: 16, bottom: 24, left: 40 };
  const W = width  - PAD.left - PAD.right;
  const H = height - PAD.top  - PAD.bottom;

  const values = points.map(p => p.value).filter(v => typeof v === 'number' && isFinite(v));
  if (!values.length) return null;

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = maxV - minV || 1;
  const minT = points[0].timestamp;
  const maxT = points[points.length - 1].timestamp;
  const rangeT = maxT - minT || 1;

  const toX = t  => PAD.left + ((t - minT) / rangeT) * W;
  const toY = v  => PAD.top  + H - ((v - minV) / rangeV) * H;

  const polyline = points
    .filter(p => typeof p.value === 'number' && isFinite(p.value))
    .map(p => `${toX(p.timestamp).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(' ');

  const normalY1 = meta.normalHigh !== undefined ? toY(Math.min(meta.normalHigh, maxV + rangeV * 0.1)) : null;
  const normalY2 = meta.normalLow  !== undefined ? toY(Math.max(meta.normalLow,  minV - rangeV * 0.1)) : null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#f8fafc"/>
    ${normalY1 !== null ? `<line x1="${PAD.left}" y1="${normalY1}" x2="${PAD.left + W}" y2="${normalY1}" stroke="#d97706" stroke-width="1" stroke-dasharray="4,3"/>` : ''}
    ${normalY2 !== null ? `<line x1="${PAD.left}" y1="${normalY2}" x2="${PAD.left + W}" y2="${normalY2}" stroke="#d97706" stroke-width="1" stroke-dasharray="4,3"/>` : ''}
    <polyline points="${polyline}" fill="none" stroke="#0284c7" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="${PAD.left}" y="${height - 6}" font-family="Arial,Helvetica,sans-serif" font-size="9" fill="#94a3b8">${meta.label} (${meta.unit})</text>
  </svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width  = width * 2;
      c.height = height * 2;
      const ctx = c.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
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
