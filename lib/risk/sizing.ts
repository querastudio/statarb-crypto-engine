// Position sizing and risk guards.
//
// Philosophy: many small, uncorrelated bets. Risk a fixed small fraction of
// equity per trade, cap concurrent positions, and stop on structural breaks.

import { config } from "@/lib/config";

export interface SizingInput {
  /** Current account equity (quote currency). */
  equity: number;
  /** Entry price of leg A. */
  priceA: number;
  /** Entry price of leg B. */
  priceB: number;
  /** Hedge ratio (units of B per unit of A). */
  beta: number;
  /** Distance (in spread units) from entry to the stop level. */
  spreadStopDistance: number;
  /** Fraction of equity to risk on this trade (default from config). */
  riskPerTrade?: number;
}

export interface SizingResult {
  /** Units of asset A to trade. */
  unitsA: number;
  /** Units of asset B to trade (hedge leg). */
  unitsB: number;
  /** Gross notional deployed (|A| + |beta·B|) per unit of A, times unitsA. */
  grossNotional: number;
  /** Capital at risk to the stop (≈ riskPerTrade · equity). */
  capitalAtRisk: number;
}

/**
 * Size a spread position so that hitting the stop loses ~riskPerTrade of equity.
 * The spread moves `spreadStopDistance` (per 1 unit of A) before the stop, so
 * unitsA = (riskPerTrade·equity) / spreadStopDistance.
 */
export function sizePosition(input: SizingInput): SizingResult {
  const risk = input.riskPerTrade ?? config.riskPerTrade;
  const capitalAtRisk = input.equity * risk;
  const stopDist = Math.abs(input.spreadStopDistance);

  const unitsA = stopDist > 0 ? capitalAtRisk / stopDist : 0;
  const unitsB = unitsA * Math.abs(input.beta);
  const grossNotional = unitsA * Math.abs(input.priceA) + unitsB * Math.abs(input.priceB);

  return { unitsA, unitsB, grossNotional, capitalAtRisk };
}

/** Whether a new position may be opened given current open count. */
export function canOpenPosition(openPositions: number): boolean {
  return openPositions < config.maxConcurrentPositions;
}

export interface BreakGuardInput {
  /** Latest cointegration p-value from a periodic re-test. */
  adfPValue: number;
  /** Bars the position has been held. */
  barsHeld: number;
  /** Spread half-life (bars). */
  halfLife: number;
  /** Latest absolute z-score. */
  absZScore: number;
}

export interface BreakGuardResult {
  shouldClose: boolean;
  shouldBlacklist: boolean;
  reason?: string;
}

/**
 * Structural-break & time guard. Closes (and possibly blacklists) a pair that
 * is no longer cointegrated, has blown through the stop, or has failed to
 * converge within 2x its half-life.
 */
export function evaluateBreakGuard(input: BreakGuardInput): BreakGuardResult {
  if (input.adfPValue > config.adfPValueMax) {
    return {
      shouldClose: true,
      shouldBlacklist: true,
      reason: "cointegration broke (ADF p-value above threshold)",
    };
  }
  if (input.absZScore > config.stopThreshold) {
    return { shouldClose: true, shouldBlacklist: false, reason: "z beyond stop threshold" };
  }
  if (Number.isFinite(input.halfLife) && input.barsHeld > 2 * input.halfLife) {
    return { shouldClose: true, shouldBlacklist: false, reason: "time stop (>2x half-life)" };
  }
  return { shouldClose: false, shouldBlacklist: false };
}
