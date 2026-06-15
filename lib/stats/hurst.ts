// Hurst exponent via the "variance of lagged differences" (generalized
// diffusion) method.
//
// For a series x, compute the standard deviation of (x_{t+τ} - x_t) for a range
// of lags τ. For a process whose increments scale like τ^H, the log-log slope
// of std vs τ estimates H:
//
//   H < 0.5  → mean-reverting (anti-persistent)
//   H = 0.5  → random walk
//   H > 0.5  → trending (persistent)

import { linearRegression } from "./ols";

function std(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  let v = 0;
  for (const x of values) v += (x - mean) ** 2;
  return Math.sqrt(v / (n - 1));
}

/**
 * Estimate the Hurst exponent of `series`. `maxLag` caps the largest lag used
 * (default min(20, n/2)).
 */
export function hurstExponent(series: number[], maxLag?: number): number {
  const n = series.length;
  if (n < 20) return 0.5; // not enough data; assume random walk

  const top = maxLag ?? Math.min(20, Math.floor(n / 2));
  const minLag = 2;
  if (top <= minLag) return 0.5;

  const logLags: number[] = [];
  const logTau: number[] = [];

  for (let lag = minLag; lag <= top; lag++) {
    const diffs: number[] = [];
    for (let i = 0; i + lag < n; i++) diffs.push(series[i + lag] - series[i]);
    const s = std(diffs);
    if (s <= 0) continue; // flat at this lag; skip
    logLags.push(Math.log(lag));
    logTau.push(Math.log(s));
  }

  if (logLags.length < 2) return 0.5;

  const { beta } = linearRegression(logLags, logTau);
  // Slope is the Hurst exponent. Clamp to [0, 1] for robustness.
  return Math.max(0, Math.min(1, beta));
}
