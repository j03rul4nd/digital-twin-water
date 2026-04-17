/**
 * BaselineEngine.js — Pure stateless functions for adaptive anomaly detection.
 *
 * No EventBus, no imports from ui/ or core/. Pure inputs → pure outputs.
 * Same pattern as AnalyticsEngine.js — named exports, no class, no state.
 */

// Short display names for sensors used in ADAPTIVE_RULES.
// Kept here to avoid importing SensorConfig and stay fully self-contained.
const SHORT_LABELS = {
  inlet_flow:          'Inlet Flow',
  filter_1_dp:         'Filter #1 DP',
  filter_2_dp:         'Filter #2 DP',
  filtered_turbidity:  'Filtered Turb.',
  residual_chlorine:   'Residual Chlorine',
};

/**
 * Computes a rolling baseline for a sensor from recent history.
 *
 * @param {string} sensorId
 * @param {{ timestamp: number, readings: Record<string, number> }[]} history
 * @param {number} windowSeconds — how far back to look (default 120s)
 * @returns {{ mean: number, std: number, n: number, windowSeconds: number } | null}
 *   null if fewer than 20 valid samples exist in the window
 */
export function computeBaseline(sensorId, history, windowSeconds = 120) {
  if (!history || history.length === 0) return null;

  const now    = history[history.length - 1].timestamp;
  const cutoff = now - windowSeconds * 1000;

  const values = [];
  for (const snapshot of history) {
    if (snapshot.timestamp < cutoff) continue;
    const v = snapshot.readings[sensorId];
    if (v === undefined || isNaN(v) || !isFinite(v)) continue;
    values.push(v);
  }

  if (values.length < 20) return null;

  const n        = values.length;
  const mean     = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std      = Math.sqrt(variance);

  return { mean, std, n, windowSeconds };
}

/**
 * Tests whether a value is anomalous relative to a baseline.
 *
 * @param {number} value
 * @param {{ mean: number, std: number } | null} baseline
 * @param {number} sigmaThreshold
 * @returns {{ anomaly: boolean, zScore: number, direction: 'high'|'low'|null }}
 */
export function isAnomaly(value, baseline, sigmaThreshold = 2.5) {
  if (baseline === null) return { anomaly: false, zScore: 0, direction: null };

  const zScore  = baseline.std === 0 ? 0 : (value - baseline.mean) / baseline.std;
  const anomaly = Math.abs(zScore) > sigmaThreshold;
  const direction = anomaly ? (value > baseline.mean ? 'high' : 'low') : null;

  return { anomaly, zScore: Math.round(zScore * 100) / 100, direction };
}

/**
 * Formats a human-readable alert message for an adaptive anomaly.
 * Example: "Filter #1 DP +2.8σ above recent baseline (μ=98.3 mbar)"
 *
 * @param {string} sensorId
 * @param {{ zScore: number, direction: 'high'|'low' }} result
 * @param {{ mean: number }} baseline
 * @param {string} unit
 * @returns {string}
 */
export function formatAnomalyMessage(sensorId, result, baseline, unit) {
  const name      = SHORT_LABELS[sensorId] ?? sensorId;
  const sign      = result.direction === 'high' ? '+' : '−';
  const relWord   = result.direction === 'high' ? 'above' : 'below';
  const z         = Math.abs(result.zScore).toFixed(1);
  const mu        = _formatMean(baseline.mean);
  const unitStr   = unit ? ` ${unit}` : '';
  return `${name} ${sign}${z}σ ${relWord} recent baseline (μ=${mu}${unitStr})`;
}

function _formatMean(mean) {
  const abs = Math.abs(mean);
  if (abs >= 100) return mean.toFixed(1);
  if (abs >= 10)  return mean.toFixed(1);
  if (abs >= 1)   return mean.toFixed(2);
  return mean.toFixed(3);
}
