/**
 * AnalyticsEngine.js — Statistical and signal analysis for sensor time series.
 *
 * Pure computation — no DOM, no state mutations, no imports from app modules.
 * All functions take plain arrays and return plain objects/arrays.
 *
 * Capabilities:
 *   - pearsonCorrelation  — linear correlation coefficient between two series
 *   - detectAnomalies     — Z-score outlier detection
 *   - findPeaks           — local maxima in a value array
 *   - analyzeTrend        — linear regression with R² and direction
 *   - generateInsights    — auto-generated natural-language observations
 *   - compareWindows      — statistical diff between two time windows
 */

import { computeStats } from './DataPipeline.js';

// ─── Correlation ──────────────────────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two value arrays.
 * Both arrays are truncated to the same length.
 *
 * @param {number[]} seriesA
 * @param {number[]} seriesB
 * @returns {{ r: number, interpretation: string, strength: string } | null}
 *
 * Interpretation:
 *   |r| > 0.9  → Very strong
 *   |r| > 0.7  → Strong
 *   |r| > 0.5  → Moderate
 *   |r| > 0.3  → Weak
 *   otherwise  → Negligible
 */
export function pearsonCorrelation(seriesA, seriesB) {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 5) return null;

  const a = seriesA.slice(-n);
  const b = seriesB.slice(-n);

  const avgA = a.reduce((s, v) => s + v, 0) / n;
  const avgB = b.reduce((s, v) => s + v, 0) / n;

  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - avgA;
    const db = b[i] - avgB;
    num  += da * db;
    denA += da * da;
    denB += db * db;
  }

  const denom = Math.sqrt(denA * denB);
  if (denom === 0) return { r: 0, interpretation: 'No variation', strength: 'none' };

  const r    = num / denom;
  const absR = Math.abs(r);

  const strength = absR > 0.9 ? 'very strong'
    : absR > 0.7 ? 'strong'
    : absR > 0.5 ? 'moderate'
    : absR > 0.3 ? 'weak'
    : 'negligible';

  const dir = r > 0 ? 'positive' : 'negative';

  return {
    r,
    strength,
    interpretation: absR > 0.3
      ? `${strength.charAt(0).toUpperCase() + strength.slice(1)} ${dir} correlation`
      : 'No significant correlation',
    stars: absR > 0.9 ? '★★★' : absR > 0.7 ? '★★' : absR > 0.5 ? '★' : '',
  };
}

// ─── Anomaly detection ────────────────────────────────────────────────────────

/**
 * Detect anomalies using the Z-score method (modified Z-score for robustness).
 * Uses median and MAD (median absolute deviation) instead of mean/std to be
 * resistant to the outliers themselves skewing the detection baseline.
 *
 * @param {number[]} values
 * @param {number}   threshold — Z-score threshold (default 2.5)
 * @returns {{ index: number, value: number, zScore: number, direction: string }[]}
 */
export function detectAnomalies(values, threshold = 2.5) {
  if (values.length < 10) return [];

  // Median
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;

  // MAD — median absolute deviation
  const deviations = values.map(v => Math.abs(v - median));
  const devSorted  = [...deviations].sort((a, b) => a - b);
  const devMid     = Math.floor(devSorted.length / 2);
  const mad        = devSorted.length % 2
    ? devSorted[devMid]
    : (devSorted[devMid - 1] + devSorted[devMid]) / 2;

  // Modified Z-score: 0.6745 * (x - median) / MAD
  // Using constant 0.6745 so score corresponds to standard normal distribution
  const scale = mad > 0 ? 0.6745 / mad : 0;

  return values.reduce((acc, v, i) => {
    const z = Math.abs((v - median) * scale);
    if (z > threshold) {
      acc.push({
        index:     i,
        value:     v,
        zScore:    z,
        direction: v > median ? 'high' : 'low',
      });
    }
    return acc;
  }, []);
}

// ─── Peak detection ───────────────────────────────────────────────────────────

/**
 * Find local maxima and minima in a values array.
 * A peak is strictly greater than all neighbors within `radius` samples.
 * A valley is strictly less than all neighbors within `radius` samples.
 *
 * @param {number[]} values
 * @param {number}   radius — neighbourhood radius in samples
 * @returns {{ peaks: number[], valleys: number[] }} — arrays of indices
 */
export function findPeaksAndValleys(values, radius = 5) {
  const peaks   = [];
  const valleys = [];

  for (let i = radius; i < values.length - radius; i++) {
    let isPeak   = true;
    let isValley = true;

    for (let d = 1; d <= radius; d++) {
      if (values[i] <= values[i - d] || values[i] <= values[i + d]) isPeak   = false;
      if (values[i] >= values[i - d] || values[i] >= values[i + d]) isValley = false;
      if (!isPeak && !isValley) break;
    }

    if (isPeak)   peaks.push(i);
    if (isValley) valleys.push(i);
  }

  return { peaks, valleys };
}

// ─── Trend analysis ───────────────────────────────────────────────────────────

/**
 * Linear trend analysis via Ordinary Least Squares regression.
 *
 * @param {{ value: number }[]} history
 * @returns {{
 *   slope:     number,   // units per sample
 *   slopeSec:  number,   // units per second (using 500ms sample rate)
 *   intercept: number,
 *   r2:        number,   // coefficient of determination (0..1)
 *   direction: 'rising' | 'falling' | 'stable',
 *   strength:  number,   // 0..1 — how well data fits the line
 *   arrow:     string,   // ↗ ↘ →
 * } | null}
 */
export function analyzeTrend(history) {
  const n = history.length;
  if (n < 5) return null;

  const values = history.map(h => h.value);

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  values.forEach((v, i) => {
    sumX  += i;
    sumY  += v;
    sumXY += i * v;
    sumXX += i * i;
  });

  const denom     = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² — proportion of variance explained by the trend line
  const avgY = sumY / n;
  let ssTot = 0, ssRes = 0;
  values.forEach((v, i) => {
    ssTot += (v - avgY) ** 2;
    ssRes += (v - (slope * i + intercept)) ** 2;
  });
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  // Direction: use slope normalized against value range
  const range = Math.max(...values) - Math.min(...values);
  const normalizedSlope = range > 0 ? (slope * n) / range : 0;
  const direction = Math.abs(normalizedSlope) < 0.05 ? 'stable'
    : normalizedSlope > 0 ? 'rising' : 'falling';

  // strength: how much of the range is covered by the trend
  const strength = Math.min(1, Math.abs(normalizedSlope));

  const arrow = direction === 'rising' ? '↗' : direction === 'falling' ? '↘' : '→';

  return {
    slope,
    slopeSec: slope / 0.5,   // 500ms sample rate → per second
    intercept,
    r2,
    direction,
    strength,
    arrow,
  };
}

// ─── Window comparison ────────────────────────────────────────────────────────

/**
 * Compare two time windows of the same sensor.
 * Returns relative changes and significance.
 *
 * @param {number[]} windowA — older window values
 * @param {number[]} windowB — newer window values
 * @returns {{ deltaAvg, deltaStd, deltaMax, relChangeAvg, direction, significant }}
 */
export function compareWindows(windowA, windowB) {
  const statsA = computeStats(windowA);
  const statsB = computeStats(windowB);
  if (!statsA || !statsB) return null;

  const deltaAvg    = statsB.avg - statsA.avg;
  const deltaStd    = statsB.std - statsA.std;
  const deltaMax    = statsB.max - statsA.max;
  const relChangeAvg = statsA.avg !== 0 ? deltaAvg / Math.abs(statsA.avg) : 0;

  // Consider significant if delta > 1 std dev of window A
  const significant = Math.abs(deltaAvg) > statsA.std;

  return {
    deltaAvg,
    deltaStd,
    deltaMax,
    relChangeAvg,
    statsA,
    statsB,
    direction:   deltaAvg > 0 ? 'increased' : deltaAvg < 0 ? 'decreased' : 'stable',
    significant,
    pctChange:   (relChangeAvg * 100).toFixed(1) + '%',
  };
}

// ─── Automatic insight generation ────────────────────────────────────────────

/**
 * Generate a list of human-readable insights from sensor history.
 * Suitable for rendering in an analytics sidebar.
 *
 * @param {string}  sensorId
 * @param {string}  label
 * @param {{ value: number, timestamp: number }[]} history
 * @param {import('../sensors/SensorConfig.js').SensorConfig} config
 * @param {import('../scene/ColorMapper.js').getSensorState} getSensorState
 * @returns {{ text: string, severity: 'info' | 'warning' | 'danger' }[]}
 */
export function generateInsights(sensorId, label, history, config, getSensorState) {
  if (history.length < 10) return [{ text: 'Collecting data…', severity: 'info' }];

  const values  = history.map(h => h.value);
  const stats   = computeStats(values);
  const trend   = analyzeTrend(history);
  const anom    = detectAnomalies(values);
  const current = values[values.length - 1];
  const state   = getSensorState(sensorId, current);

  const insights = [];

  // Current state
  if (state === 'danger') {
    insights.push({ text: `⚡ Currently in DANGER zone (${_fmt(current, config)} ${config.unit})`, severity: 'danger' });
  } else if (state === 'warning') {
    insights.push({ text: `⚠ Currently in WARNING zone (${_fmt(current, config)} ${config.unit})`, severity: 'warning' });
  }

  // Trend
  if (trend && trend.r2 > 0.4) {
    const rate = Math.abs(trend.slopeSec).toFixed(3);
    insights.push({
      text: `${trend.arrow} ${trend.direction.charAt(0).toUpperCase() + trend.direction.slice(1)} at ${rate} ${config.unit}/s (R²=${trend.r2.toFixed(2)})`,
      severity: trend.direction === 'stable' ? 'info'
        : state !== 'normal' ? 'warning' : 'info',
    });
  }

  // Approaching threshold
  if (state === 'normal' && trend) {
    const distToWarnHigh = config.warning.high - current;
    const distToWarnLow  = current - config.warning.low;
    const minDist        = Math.min(distToWarnHigh, distToWarnLow);
    const range          = stats.max - stats.min;
    if (range > 0 && minDist / range < 0.15) {
      insights.push({ text: `⚠ Approaching warning threshold (within 15% of range)`, severity: 'warning' });
    }
  }

  // Anomalies
  if (anom.length > 0) {
    const recent = anom.filter(a => a.index > values.length - 20);
    if (recent.length > 0) {
      insights.push({ text: `⚡ ${recent.length} anomal${recent.length === 1 ? 'y' : 'ies'} detected in last 10 seconds`, severity: 'warning' });
    } else {
      insights.push({ text: `${anom.length} anomal${anom.length === 1 ? 'y' : 'ies'} detected in visible window`, severity: 'info' });
    }
  }

  // Volatility
  if (stats) {
    const cv = stats.avg !== 0 ? stats.std / Math.abs(stats.avg) : 0;
    if (cv > 0.2) {
      insights.push({ text: `High variability: CV=${(cv * 100).toFixed(0)}% (std ±${_fmt(stats.std, config)})`, severity: 'warning' });
    }
  }

  if (insights.length === 0) {
    insights.push({ text: `✓ Operating normally — avg ${_fmt(stats.avg, config)} ${config.unit}`, severity: 'info' });
  }

  return insights;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _fmt(value, config) {
  if (!config) return value.toFixed(2);
  if (config.rangeMax >= 100) return value.toFixed(1);
  if (config.rangeMax >= 10)  return value.toFixed(2);
  return value.toFixed(3);
}
