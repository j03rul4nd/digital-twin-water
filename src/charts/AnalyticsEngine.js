/**
 * AnalyticsEngine.js — Motor de análisis de datos para el sistema de visualización.
 *
 * Módulo de funciones puras (stateless). Todas las funciones toman datos
 * como argumentos y devuelven resultados sin efectos secundarios.
 * Diseñado para ser tree-shakeable: importar solo lo necesario.
 *
 * Contenido:
 *   computeStats(values)          — descriptive statistics
 *   computeDerivative(history)    — rate of change per second
 *   detectAnomalies(history, opts)— Z-score based anomaly detection
 *   detectPeaks(values, opts)     — local min/max detection
 *   computeCorrelation(a, b)      — Pearson correlation coefficient
 *   computeCorrelationMatrix(map) — correlation matrix for multiple series
 *   lttbDownsample(data, n)       — Largest Triangle Three Buckets downsampling
 *   computeTrend(history, opts)   — linear regression trend descriptor
 *   classifyTrend(slope, std)     — 'rising' | 'falling' | 'stable'
 *   compareWindows(a, b)          — mean-shift / ratio between two time windows
 */

// ─── Descriptive statistics ───────────────────────────────────────────────────

/**
 * Computes basic statistics for an array of numeric values.
 * @param {number[]} values
 * @returns {{ mean, median, std, variance, min, max, range, n, p95 } | null}
 */
export function computeStats(values) {
  const v = values.filter(x => typeof x === 'number' && isFinite(x));
  const n = v.length;
  if (n === 0) return null;

  const mean = v.reduce((s, x) => s + x, 0) / n;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const min = Math.min(...v);
  const max = Math.max(...v);

  // Median
  const sorted = [...v].sort((a, b) => a - b);
  const mid    = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  // 95th percentile
  const p95 = sorted[Math.floor(n * 0.95)];

  return { mean, median, std, variance, min, max, range: max - min, n, p95 };
}

// ─── Rate of change ───────────────────────────────────────────────────────────

/**
 * Computes the discrete derivative (rate of change per second) of a history array.
 *
 * @param {{ timestamp: number, value: number }[]} history
 * @returns {{ timestamp: number, value: number }[]} — units/s at each point
 */
export function computeDerivative(history) {
  const result = [];
  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt <= 0 || typeof history[i].value !== 'number') continue;
    result.push({
      timestamp: history[i].timestamp,
      value:     (history[i].value - history[i - 1].value) / dt,
    });
  }
  return result;
}

// ─── Anomaly detection ────────────────────────────────────────────────────────

/**
 * Detects anomalies using Z-score method.
 * Points more than `zThreshold` standard deviations from the mean are flagged.
 *
 * @param {{ timestamp: number, value: number }[]} history
 * @param {{ zThreshold?: number }} opts
 * @returns {{ index: number, timestamp: number, value: number, zScore: number, isAnomaly: boolean }[]}
 */
export function detectAnomalies(history, { zThreshold = 2.5 } = {}) {
  const values = history.map(h => h.value).filter(v => typeof v === 'number' && isFinite(v));
  const stats  = computeStats(values);
  if (!stats || stats.std === 0) return [];

  return history
    .filter(h => typeof h.value === 'number' && isFinite(h.value))
    .map((h, i) => {
      const zScore = (h.value - stats.mean) / stats.std;
      return {
        index:     i,
        timestamp: h.timestamp,
        value:     h.value,
        zScore:    Math.round(zScore * 100) / 100,
        isAnomaly: Math.abs(zScore) > zThreshold,
      };
    });
}

// ─── Peak detection ───────────────────────────────────────────────────────────

/**
 * Detects local maxima and minima in a value series.
 * A peak/trough requires its two neighbours to be strictly lower/higher.
 *
 * @param {number[]} values
 * @param {{ minProminence?: number }} opts — minimum height difference to qualify
 * @returns {{ index: number, value: number, type: 'max'|'min' }[]}
 */
export function detectPeaks(values, { minProminence = 0 } = {}) {
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1], cur = values[i], next = values[i + 1];
    if (cur > prev && cur > next) {
      const prom = Math.min(cur - prev, cur - next);
      if (prom >= minProminence) peaks.push({ index: i, value: cur, type: 'max' });
    } else if (cur < prev && cur < next) {
      const prom = Math.min(prev - cur, next - cur);
      if (prom >= minProminence) peaks.push({ index: i, value: cur, type: 'min' });
    }
  }
  return peaks;
}

// ─── Correlation ──────────────────────────────────────────────────────────────

/**
 * Computes Pearson correlation coefficient between two equal-length arrays.
 * Returns null if insufficient data or zero variance.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number | null} — [-1, 1]
 */
export function computeCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;

  const as = a.slice(0, n);
  const bs = b.slice(0, n);
  const am = as.reduce((s, x) => s + x, 0) / n;
  const bm = bs.reduce((s, x) => s + x, 0) / n;
  const num = as.reduce((s, x, i) => s + (x - am) * (bs[i] - bm), 0);
  const den = Math.sqrt(
    as.reduce((s, x) => s + (x - am) ** 2, 0) *
    bs.reduce((s, x) => s + (x - bm) ** 2, 0),
  );
  return den === 0 ? null : Math.round((num / den) * 1000) / 1000;
}

/**
 * Builds a full correlation matrix for multiple named series.
 *
 * @param {Map<string, number[]>} seriesMap — { sensorId → values[] }
 * @returns {Map<string, Map<string, number|null>>}
 */
export function computeCorrelationMatrix(seriesMap) {
  const ids = [...seriesMap.keys()];
  const matrix = new Map();

  ids.forEach(a => {
    const row = new Map();
    ids.forEach(b => {
      row.set(b, a === b ? 1.0 : computeCorrelation(seriesMap.get(a), seriesMap.get(b)));
    });
    matrix.set(a, row);
  });

  return matrix;
}

/**
 * Human-readable label for a correlation value.
 * @param {number|null} r
 * @returns {{ label: string, strength: 'strong'|'moderate'|'weak'|'none', sign: '+'|'-'|'' }}
 */
export function describeCorrelation(r) {
  if (r === null) return { label: 'N/A', strength: 'none', sign: '' };
  const abs = Math.abs(r);
  const sign = r > 0 ? '+' : r < 0 ? '-' : '';
  if (abs >= 0.8) return { label: `${sign}Strong`,   strength: 'strong',   sign };
  if (abs >= 0.5) return { label: `${sign}Moderate`, strength: 'moderate', sign };
  if (abs >= 0.2) return { label: `${sign}Weak`,     strength: 'weak',     sign };
  return { label: 'None', strength: 'none', sign };
}

// ─── LTTB Downsampling ────────────────────────────────────────────────────────

/**
 * Largest Triangle Three Buckets (LTTB) downsampling algorithm.
 * Reduces a dataset to `targetPoints` representative points while
 * preserving visual shape. Best-in-class for time-series rendering.
 *
 * @param {{ timestamp: number, value: number }[]} data
 * @param {number} targetPoints
 * @returns {{ timestamp: number, value: number }[]}
 */
export function lttbDownsample(data, targetPoints) {
  const n = data.length;
  if (n <= targetPoints) return data;
  if (targetPoints < 3) return [data[0], data[n - 1]];

  const sampled    = [data[0]];
  const bucketSize = (n - 2) / (targetPoints - 2);
  let   aIdx       = 0; // index of previously selected point

  for (let i = 0; i < targetPoints - 2; i++) {
    // Current bucket bounds
    const bStart = Math.floor((i + 1) * bucketSize) + 1;
    const bEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // Next bucket average (for triangle area)
    const cStart = bEnd;
    const cEnd   = Math.min(Math.floor((i + 3) * bucketSize) + 1, n);
    let avgX = 0, avgY = 0, cCount = 0;
    for (let j = cStart; j < cEnd; j++) {
      avgX += j;
      avgY += data[j].value;
      cCount++;
    }
    if (cCount > 0) { avgX /= cCount; avgY /= cCount; }
    else            { avgX = bEnd; avgY = data[Math.min(bEnd, n - 1)].value; }

    // Select point in current bucket with largest triangle area
    let maxArea = -1;
    let selected = bStart;
    const aX = aIdx, aY = data[aIdx].value;

    for (let j = bStart; j < bEnd; j++) {
      const area = Math.abs(
        (aX - avgX) * (data[j].value - aY) -
        (aX - j)    * (avgY - aY),
      ) * 0.5;
      if (area > maxArea) { maxArea = area; selected = j; }
    }

    sampled.push(data[selected]);
    aIdx = selected;
  }

  sampled.push(data[n - 1]);
  return sampled;
}

// ─── Trend analysis ───────────────────────────────────────────────────────────

/**
 * Computes a linear regression trend descriptor for a history array.
 * Uses the same least-squares logic as SensorState.getTrend() but is stateless.
 *
 * @param {{ timestamp: number, value: number }[]} history
 * @param {{ stableThreshold?: number }} opts
 * @returns {{ slope, delta, mean, first, last, direction, samples } | null}
 */
export function computeTrend(history, { stableThreshold = 0.05 } = {}) {
  const pts = history.filter(h => typeof h.value === 'number' && isFinite(h.value));
  if (pts.length < 2) return null;

  const tBase = pts[0].timestamp;
  const n = pts.length;
  let sumT = 0, sumV = 0, sumTV = 0, sumTT = 0;

  pts.forEach(({ timestamp, value }) => {
    const t = (timestamp - tBase) / 1000;
    sumT  += t;
    sumV  += value;
    sumTV += t * value;
    sumTT += t * t;
  });

  const denom = n * sumTT - sumT * sumT;
  const slope = denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;
  const mean  = sumV / n;
  const first = pts[0].value;
  const last  = pts[n - 1].value;
  const delta = last - first;

  const direction =
    Math.abs(slope) < stableThreshold ? 'stable'  :
    slope > 0                         ? 'rising'  : 'falling';

  return { slope, delta, mean, first, last, direction, samples: n };
}

/**
 * Returns a human-readable trend label with arrow and rate.
 * @param {{ direction: string, slope: number }} trend
 * @param {string} unit
 * @returns {string} — e.g. "↗ +2.4 m³/h·s"
 */
export function formatTrend(trend, unit = '') {
  if (!trend) return '— stable';
  const arrow = { rising: '↗', falling: '↘', stable: '→' }[trend.direction] ?? '→';
  const rate  = Math.abs(trend.slope);
  const sign  = trend.slope >= 0 ? '+' : '−';
  if (rate < 0.001) return `${arrow} stable`;
  const fmtRate = rate < 0.01 ? rate.toFixed(4) :
                  rate < 1    ? rate.toFixed(3)  :
                  rate < 10   ? rate.toFixed(2)  : rate.toFixed(1);
  return `${arrow} ${sign}${fmtRate} ${unit}/s`;
}

// ─── Window comparison ────────────────────────────────────────────────────────

/**
 * Compares two arrays of values (e.g., first vs second half of history).
 * @param {number[]} a — baseline window
 * @param {number[]} b — comparison window
 * @returns {{ meanDelta, meanDeltaRel, stdDelta, significant: boolean }}
 */
export function compareWindows(a, b) {
  const sA = computeStats(a);
  const sB = computeStats(b);
  if (!sA || !sB) return null;

  const meanDelta    = sB.mean - sA.mean;
  const meanDeltaRel = sA.mean !== 0 ? meanDelta / Math.abs(sA.mean) : 0;
  const stdDelta     = sB.std  - sA.std;

  // Rough significance test: mean shift > 1 std of baseline
  const significant = Math.abs(meanDelta) > sA.std;

  return { meanDelta, meanDeltaRel, stdDelta, significant };
}
