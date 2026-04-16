/**
 * FinancialAnalytics.js — Pure financial/industrial analytics functions.
 *
 * Stateless, no side effects, no imports from ui/ or core/.
 * Consumed by SensorDetailModal, KPIEngine, and MultiChartPanel.
 */

// ─── OEE ─────────────────────────────────────────────────────────────────────

export function computeOEE(history, config) {
  if (!history || history.length === 0) return null;
  const values       = history.map(p => p.value);
  const finite       = values.filter(v => typeof v === 'number' && isFinite(v));
  const n            = finite.length;
  const availability = n / history.length;
  const mean         = n > 0 ? finite.reduce((a, b) => a + b, 0) / n : 0;
  const performance  = Math.min(1, Math.max(0, mean / config.rangeMax));
  const quality      = n > 0
    ? finite.filter(v => v >= config.warning.low && v <= config.warning.high).length / n
    : 0;
  return { oee: availability * performance * quality, availability, performance, quality };
}

// ─── Cost per unit ────────────────────────────────────────────────────────────

export function computeCostPerUnit(currentValue, analyticsConfig) {
  if (currentValue == null || currentValue <= 0) return null;
  const { pumpPowerKW, energyCostPerHour, chemicalCostPerM3 } = analyticsConfig.costPerUnit;
  const energyCost       = pumpPowerKW * energyCostPerHour;
  const totalCostPerHour = energyCost + currentValue * chemicalCostPerM3;
  return { costPerUnit: totalCostPerHour / currentValue, totalCostPerHour };
}

// ─── Degradation (linear regression → ETA to danger threshold) ────────────────

export function computeDegradation(history, config, analyticsConfig) {
  const { minSamples } = analyticsConfig.degradation;
  if (!history || history.length < minSamples) return null;

  const pts = [];
  for (let i = 0; i < history.length; i++) {
    const v = history[i].value;
    if (typeof v === 'number' && isFinite(v)) pts.push({ x: i, y: v });
  }
  if (pts.length < minSamples) return null;

  const n = pts.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const { x, y } of pts) { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return { degrading: false };

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  if (Math.abs(slope) < 1e-6) return { degrading: false };

  const threshold              = slope > 0 ? config.danger.high : config.danger.low;
  const timeToThresholdSeconds = ((threshold - intercept) / slope) * 0.5;
  return { degrading: true, timeToThresholdSeconds, slope };
}

// ─── Volatility (rolling std vs historical std) ───────────────────────────────

export function computeVolatility(history, analyticsConfig) {
  if (!history || history.length < 2) return null;
  const all = history.map(p => p.value).filter(v => typeof v === 'number' && isFinite(v));
  if (all.length < 2) return null;

  const hMean        = all.reduce((a, b) => a + b, 0) / all.length;
  const historicalStd = Math.sqrt(all.reduce((a, v) => a + (v - hMean) ** 2, 0) / all.length);
  if (historicalStd < 1e-10) return null;

  const win    = history.slice(-analyticsConfig.volatility.windowSize)
    .map(p => p.value).filter(v => typeof v === 'number' && isFinite(v));
  if (win.length < 2) return null;
  const wMean     = win.reduce((a, b) => a + b, 0) / win.length;
  const currentStd = Math.sqrt(win.reduce((a, v) => a + (v - wMean) ** 2, 0) / win.length);

  const ratio = currentStd / historicalStd;
  const level = ratio < 0.7 ? 'low' : ratio <= 1.4 ? 'normal' : 'high';
  return { currentStd, historicalStd, ratio, level };
}

// ─── Sharpe ratio (industrial adaptation) ────────────────────────────────────

export function computeSharpe(history, config, analyticsConfig) {
  if (!history || history.length < 2) return null;
  const vals = history.map(p => p.value).filter(v => typeof v === 'number' && isFinite(v));
  if (vals.length < 2) return null;

  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std  = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  if (std < 1e-6) return null;

  const baseline = analyticsConfig.sharpe.baseline === 0 ? config.normal.low : analyticsConfig.sharpe.baseline;
  return { sharpe: (mean - baseline) / std, mean, std, baseline };
}

// ─── Economic impact (€ deviation cost) ──────────────────────────────────────

export function computeEconomicImpact(currentValue, config, analyticsConfig) {
  if (currentValue == null) return null;
  if (currentValue >= config.normal.low && currentValue <= config.normal.high) {
    return { inRange: true, impact2h: 0 };
  }
  const deviation = currentValue < config.normal.low
    ? config.normal.low  - currentValue
    : currentValue - config.normal.high;
  const impactPerHour = deviation * analyticsConfig.economicImpact.costPerDeviationUnit;
  return { inRange: false, deviation, impactPerHour, impact2h: impactPerHour * 2 };
}

// ─── Duration formatter ───────────────────────────────────────────────────────

export function formatDuration(seconds) {
  if (seconds < 3600)  return Math.round(seconds / 60) + 'm';
  if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h';
  return (seconds / 86400).toFixed(1) + 'd';
}
