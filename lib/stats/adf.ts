// Augmented Dickey-Fuller unit-root test ("constant, no trend" specification).
//
// Regression:
//   Δy_t = α + γ·y_{t-1} + Σ_{i=1..p} δ_i·Δy_{t-i} + ε_t
//
// The test statistic is the t-stat on γ. Under the null hypothesis y has a
// unit root (γ = 0, non-stationary). We reject (→ stationary) when the
// statistic is sufficiently negative.
//
// p-values use MacKinnon-style critical-value interpolation for the constant
// case. This is an approximation suitable for ranking/decision-making; the 5%
// decision threshold (-2.86) is exact in the large-sample limit.

import { ols } from "./ols";
import type { ADFResult } from "@/lib/types";

// Large-sample critical values, constant (no trend), MacKinnon (2010).
const CRIT = { "1%": -3.43, "5%": -2.86, "10%": -2.57 } as const;

// Quantile table of the ADF tau distribution (constant, no trend) used to
// interpolate an approximate p-value from the test statistic.
// Pairs of [tau, cumulative probability].
const TAU_TABLE: Array<[number, number]> = [
  [-4.5, 0.001],
  [-3.96, 0.005],
  [-3.43, 0.01],
  [-3.12, 0.025],
  [-2.86, 0.05],
  [-2.57, 0.1],
  [-2.26, 0.2],
  [-1.95, 0.35],
  [-1.62, 0.5],
  [-1.22, 0.65],
  [-0.84, 0.8],
  [-0.44, 0.9],
  [-0.07, 0.95],
  [0.23, 0.975],
  [0.6, 0.99],
  [1.0, 0.999],
];

/** Interpolate an approximate p-value from the ADF tau statistic. */
function mackinnonP(tau: number): number {
  const table = TAU_TABLE;
  if (tau <= table[0][0]) return table[0][1];
  if (tau >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, p0] = table[i];
    const [t1, p1] = table[i + 1];
    if (tau >= t0 && tau <= t1) {
      const frac = (tau - t0) / (t1 - t0);
      return p0 + frac * (p1 - p0);
    }
  }
  return 0.5;
}

/** First difference of a series. */
function diff(series: number[]): number[] {
  const out = new Array(series.length - 1);
  for (let i = 1; i < series.length; i++) out[i - 1] = series[i] - series[i - 1];
  return out;
}

/**
 * Default lag selection à la statsmodels' "12*(n/100)^(1/4)" rule, capped so
 * the regression keeps enough degrees of freedom.
 */
function defaultMaxLag(n: number): number {
  const rule = Math.floor(12 * Math.pow(n / 100, 0.25));
  return Math.max(0, Math.min(rule, Math.floor(n / 3)));
}

export interface ADFOptions {
  /** Number of augmenting lags. If undefined, uses the default rule. */
  maxLag?: number;
}

/**
 * Augmented Dickey-Fuller test on `series` (the levels), constant case.
 */
export function adfTest(series: number[], options: ADFOptions = {}): ADFResult {
  const y = series.filter((v) => Number.isFinite(v));
  if (y.length < 12) {
    throw new Error("ADF: need at least ~12 observations.");
  }

  const p = options.maxLag ?? defaultMaxLag(y.length);

  // Build regression of Δy_t on [const, y_{t-1}, Δy_{t-1}, ..., Δy_{t-p}].
  const dy = diff(y); // length N-1, dy[t] = y[t+1]-y[t]
  // For each usable t (need p prior diffs and a lagged level), align indices.
  // Let the response be dy[i] for i = p .. dy.length-1.
  // Regressors at that i:
  //   y_{t-1} = y[i]            (since dy[i] = y[i+1]-y[i])
  //   Δy_{t-j} = dy[i-j]
  const startI = p; // first index with p lags available
  const rows: number[][] = [];
  const resp: number[] = [];
  for (let i = startI; i < dy.length; i++) {
    const row = [1, y[i]]; // intercept, lagged level
    for (let j = 1; j <= p; j++) row.push(dy[i - j]);
    rows.push(row);
    resp.push(dy[i]);
  }

  const fit = ols(rows, resp);
  // Coefficient index 1 is γ (on the lagged level).
  const statistic = fit.tStats[1];
  const pValue = mackinnonP(statistic);

  return {
    statistic,
    pValue,
    usedLag: p,
    nobs: resp.length,
    criticalValues: { ...CRIT },
    stationary: statistic < CRIT["5%"],
  };
}
