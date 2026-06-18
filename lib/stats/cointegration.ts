// Engle-Granger two-step cointegration test for the pair (A, B).
//
// Step 1: estimate the cointegrating regression  A = α + β·B + residual (OLS).
// Step 2: test the residual for stationarity with the ADF test (using the
//         Engle-Granger residual critical values). If stationary, A and B are
//         cointegrated and β is the hedge ratio used to form the trading spread.
//
// Engle-Granger is order-sensitive: regressing A on B and B on A can disagree.
// Naively running both and keeping the MORE significant one introduces a
// selection bias that inflates false positives (picking the best of two tests).
// Instead we require BOTH directions to reject the unit root — an order-robust,
// conservative rule that favours fewer, cleaner pairs — and report the more
// conservative (larger) p-value so the FDR ranking gains nothing from selection.
// The hedge ratio comes from the canonical A = α + β·B regression so the spread
// A − (α + β·B) is consistent everywhere downstream.

import { linearRegression } from "./ols";
import { adfTest } from "./adf";
import type { CointegrationResult } from "@/lib/types";

export function engleGranger(priceA: number[], priceB: number[]): CointegrationResult {
  if (priceA.length !== priceB.length) {
    throw new Error("engleGranger: series length mismatch.");
  }
  if (priceA.length < 30) {
    throw new Error("engleGranger: need at least 30 aligned observations.");
  }

  // Direction 1: A = alpha + beta*B + e   (canonical — supplies the hedge ratio).
  const d1 = linearRegression(priceB, priceA);
  const adf1 = adfTest(d1.result.residuals, { variant: "coint-residual" });

  // Direction 2: B = a' + b'*A + e'  (the reverse regression, for robustness).
  const d2 = linearRegression(priceA, priceB);
  const adf2 = adfTest(d2.result.residuals, { variant: "coint-residual" });

  // Cointegrated only if BOTH directions reject; p-value is the worse of the two.
  const cointegrated = adf1.stationary && adf2.stationary;
  const pValue = Math.max(adf1.pValue, adf2.pValue);

  return { beta: d1.beta, alpha: d1.alpha, adf: adf1, pValue, cointegrated };
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
