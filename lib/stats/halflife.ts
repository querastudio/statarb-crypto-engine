// Half-life of mean reversion via an Ornstein-Uhlenbeck fit.
//
// Discretized OU:  Δspread_t = α + λ·spread_{t-1} + ε_t
// For a mean-reverting series λ is negative. The continuous-time mean-reversion
// speed is  θ = -ln(1 + λ)  ≈ -λ  for small λ, and the half-life (number of
// bars to revert halfway to the mean) is:
//
//   half_life = -ln(2) / ln(1 + λ)
//
// We use ln(1+λ) (rather than the -ln(2)/λ approximation) for accuracy.

import { linearRegression } from "./ols";

/**
 * Estimate the half-life (in bars) of a spread series. Returns Infinity when
 * the series is not mean-reverting (λ ≥ 0) or the estimate is degenerate.
 */
export function halfLife(spread: number[]): number {
  if (spread.length < 10) return Infinity;

  const lagged: number[] = [];
  const delta: number[] = [];
  for (let i = 1; i < spread.length; i++) {
    lagged.push(spread[i - 1]);
    delta.push(spread[i] - spread[i - 1]);
  }

  const { beta: lambda } = linearRegression(lagged, delta);

  // Not mean-reverting (or numerically flat): no finite half-life.
  if (lambda >= 0) return Infinity;
  const onePlus = 1 + lambda;
  if (onePlus <= 0) return Infinity; // overshoot / oscillatory, treat as invalid

  const hl = -Math.log(2) / Math.log(onePlus);
  return hl > 0 && Number.isFinite(hl) ? hl : Infinity;
}
