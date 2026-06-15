// Engle-Granger two-step cointegration test for an ordered pair (A, B).
//
// Step 1: estimate the cointegrating regression  A = α + β·B + residual (OLS).
// Step 2: test the residual for stationarity with the ADF test. If the
//         residual is stationary, A and B are cointegrated and β is the hedge
//         ratio used to form the trading spread.

import { linearRegression } from "./ols";
import { adfTest } from "./adf";
import type { CointegrationResult } from "@/lib/types";

/**
 * Test cointegration of priceA on priceB (ordered). Series must be the same
 * length and aligned in time.
 */
export function engleGranger(priceA: number[], priceB: number[]): CointegrationResult {
  if (priceA.length !== priceB.length) {
    throw new Error("engleGranger: series length mismatch.");
  }
  if (priceA.length < 30) {
    throw new Error("engleGranger: need at least 30 aligned observations.");
  }

  // Step 1: cointegrating regression A = alpha + beta*B + e.
  const { alpha, beta, result } = linearRegression(priceB, priceA);
  const residuals = result.residuals;

  // Step 2: ADF on residuals (no separate intercept needed — residuals are
  // mean-zero by construction, but the ADF regression includes a constant,
  // which is the standard, conservative choice).
  const adf = adfTest(residuals);

  return {
    beta,
    alpha,
    adf,
    pValue: adf.pValue,
    cointegrated: adf.stationary,
  };
}

/** Compute the static spread  A - (alpha + beta*B). */
export function staticSpread(
  priceA: number[],
  priceB: number[],
  beta: number,
  alpha = 0,
): number[] {
  return priceA.map((a, i) => a - (alpha + beta * priceB[i]));
}
