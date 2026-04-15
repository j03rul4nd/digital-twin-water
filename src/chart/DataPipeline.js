/**
 * DataPipeline.js — Data transformation layer for chart rendering.
 *
 * Pure functions — no side effects, no DOM, no external state.
 * Takes data arrays in, returns transformed arrays out.
 *
 * Pipeline stages (compose as needed):
 *   1. applyWindow      — slice history to a time sub-range
 *   2. downsample       — LTTB to target point count
 *   3. computeStats     — min/max/avg/std/median
 *   4. computeDerivative — rate of change per sample
 *   5. movingAverage    — smoothing filter
 *   6. alignSeries      — time-align two histories by timestamp
 *   7. normalizeToRange — scale values to 0..1 for overlay comparison
 */

// ─── Time window ──────────────────────────────────────────────────────────────

/**
 * Slice a history array to a fractional time window.
 * @param {Array}  history
 * @param {{ startFrac: number, endFrac: number } | null} window  (0..1)
 * @returns {Array}
 */
export function applyWindow(history, window) {
  if (!window || !history.length) return history;
  const n     = history.length;
  const start = Math.max(0, Math.floor(window.startFrac * n));
  const end   = Math.min(n, Math.ceil(window.endFrac * n));
  return history.slice(start, end);
}

/**
 * Convert a "last N seconds" request into a window fraction.
 * @param {Array}   history
 * @param {number}  seconds
 * @returns {{ startFrac, endFrac }}
 */
export function windowFromSeconds(history, seconds) {
  if (!history.length) return { startFrac: 0, endFrac: 1 };
  const now    = history[history.length - 1].timestamp;
  const cutoff = now - seconds * 1000;
  const idx    = history.findIndex(h => h.timestamp >= cutoff);
  if (idx < 0) return { startFrac: 0, endFrac: 1 };
  return { startFrac: idx / history.length, endFrac: 1 };
}

// ─── LTTB Downsampling ────────────────────────────────────────────────────────

/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Reduces a dataset to `targetCount` points while preserving the visual shape
 * better than uniform sampling or min-max. Standard algorithm for time-series
 * charts — used by Grafana and most production monitoring tools.
 *
 * Reference: Sveinn Steinarsson (2013) "Downsampling Time Series for Visual
 * Representation" — http://skemman.is/stream/get/1946/15343/37285/3/
 *
 * @param {{ value: number, timestamp: number }[]} data
 * @param {number} targetCount
 * @returns {typeof data}
 */
export function downsample(data, targetCount) {
  const n = data.length;
  if (n <= targetCount || targetCount < 3) return data;

  const sampled    = [data[0]];
  const bucketSize = (n - 2) / (targetCount - 2);

  let a = 0; // index of last selected point

  for (let i = 0; i < targetCount - 2; i++) {
    // Average point for the next bucket (used as point C in triangle area)
    const avgStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    let   avgY = 0;
    const avgCount = avgEnd - avgStart;
    for (let j = avgStart; j < avgEnd; j++) avgY += data[j].value;
    avgY /= avgCount;
    const avgX = (avgStart + avgEnd - 1) / 2; // mid index of next bucket

    // Current bucket range
    const rangeStart = Math.floor(i       * bucketSize) + 1;
    const rangeEnd   = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);

    const pA    = sampled[sampled.length - 1];
    let maxArea = -1;
    let maxIdx  = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      // Triangle area between A, current point, and average of next bucket
      const area = Math.abs(
        (a    - avgX) * (data[j].value - pA.value) -
        (a    - j   ) * (avgY          - pA.value)
      ) * 0.5;
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }

    sampled.push(data[maxIdx]);
    a = maxIdx;
  }

  sampled.push(data[n - 1]);
  return sampled;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

/**
 * Compute statistical summary for an array of numeric values.
 * @param {number[]} values
 * @returns {{ n, min, max, avg, std, median, variance, p95 } | null}
 */
export function computeStats(values) {
  const finite = values.filter(v => typeof v === 'number' && isFinite(v));
  const n = finite.length;
  if (n === 0) return null;

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const avg = finite.reduce((a, b) => a + b, 0) / n;
  const variance = finite.reduce((a, v) => a + (v - avg) ** 2, 0) / n;
  const std      = Math.sqrt(variance);

  const sorted = [...finite].sort((a, b) => a - b);
  const mid    = Math.floor(n / 2);
  const median = n % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  // 95th percentile
  const p95Idx = Math.min(n - 1, Math.ceil(0.95 * n) - 1);
  const p95    = sorted[p95Idx];

  return { n, min, max, avg, std, median, variance, p95 };
}

// ─── Derivative ───────────────────────────────────────────────────────────────

/**
 * First derivative (rate of change per second) of a history array.
 * Returns a new history array with the same timestamps but derivative values.
 * @param {{ value: number, timestamp: number }[]} history
 * @returns {{ value: number, timestamp: number }[]}
 */
export function computeDerivative(history) {
  if (history.length < 2) return [];
  const result = [];

  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt <= 0) continue;
    result.push({
      timestamp: history[i].timestamp,
      value:     (history[i].value - history[i - 1].value) / dt,
    });
  }
  return result;
}

// ─── Smoothing ────────────────────────────────────────────────────────────────

/**
 * Simple moving average — causal (uses past values only).
 * @param {number[]} values
 * @param {number}   windowSize — number of samples
 * @returns {number[]}
 */
export function movingAverage(values, windowSize) {
  if (windowSize < 2) return [...values];
  return values.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ─── Series alignment ────────────────────────────────────────────────────────

/**
 * Time-align two history arrays by resampling seriesB to seriesA's timestamps.
 * Uses nearest-neighbor interpolation.
 *
 * Returns a pair [alignedA, alignedB] where both have the same timestamps.
 * Entries where a match cannot be found within toleranceMs are excluded.
 *
 * @param {Array} histA
 * @param {Array} histB
 * @param {number} toleranceMs — max timestamp distance to accept as a match
 * @returns {[Array, Array]}
 */
export function alignSeries(histA, histB, toleranceMs = 1000) {
  const aligned = [];
  let   bIdx    = 0;

  for (const pointA of histA) {
    // Advance bIdx to the closest timestamp
    while (bIdx < histB.length - 1 &&
           Math.abs(histB[bIdx + 1].timestamp - pointA.timestamp) <
           Math.abs(histB[bIdx  ].timestamp - pointA.timestamp)) {
      bIdx++;
    }
    const closest = histB[bIdx];
    if (!closest) continue;
    if (Math.abs(closest.timestamp - pointA.timestamp) > toleranceMs) continue;

    aligned.push({ a: pointA, b: closest, timestamp: pointA.timestamp });
  }

  return [
    aligned.map(p => ({ timestamp: p.timestamp, value: p.a.value })),
    aligned.map(p => ({ timestamp: p.timestamp, value: p.b.value })),
  ];
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize values to 0..1 range for multi-sensor overlay comparison.
 * Uses the sensor's configured rangeMin/rangeMax for a stable scale.
 *
 * @param {number[]} values
 * @param {{ rangeMin: number, rangeMax: number }} config
 * @returns {number[]}
 */
export function normalizeToRange(values, config) {
  const range = config.rangeMax - config.rangeMin || 1;
  return values.map(v => (v - config.rangeMin) / range);
}

// ─── Export helpers ───────────────────────────────────────────────────────────

/**
 * Convert aligned histories to a flat CSV string for export.
 * @param {{ sensorId: string, label: string, unit: string, history: Array }[]} series
 * @returns {string} CSV content
 */
export function seriesToCSV(series) {
  if (!series.length) return '';

  // Use first series timestamps as anchor
  const anchor = series[0].history;
  const lines  = [`timestamp_ms,timestamp_iso,${series.map(s => `${s.label} (${s.unit})`).join(',')}`];

  anchor.forEach((point, i) => {
    const ts  = point.timestamp;
    const iso = new Date(ts).toISOString();
    const row = [ts, iso, ...series.map(s => s.history[i]?.value?.toFixed(6) ?? '')];
    lines.push(row.join(','));
  });

  return lines.join('\n');
}

/**
 * Serialize chart configuration (active sensors + settings) to JSON.
 * @param {import('./ChartStore.js').default} store
 * @param {Array} sensorsConfig — SENSORS array for label/unit lookup
 * @returns {string} JSON string
 */
export function exportChartConfig(storeState, sensorsConfig) {
  const cfg = {
    version:       '1.0',
    exportedAt:    new Date().toISOString(),
    activeSensors: storeState.activeSensors.map(id => {
      const s = sensorsConfig.find(c => c.id === id);
      return { id, label: s?.label, unit: s?.unit };
    }),
    viewWindow:    storeState.viewWindow,
    chartType:     storeState.chartType,
    scaleType:     storeState.scaleType,
    showBands:     storeState.showBands,
    showRefLines:  storeState.showRefLines,
    showMA:        storeState.showMA,
    maWindow:      storeState.maWindow,
  };
  return JSON.stringify(cfg, null, 2);
}
