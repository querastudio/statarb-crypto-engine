// Kelly Criterion position sizing.
//
// The Kelly formula answers: "What fraction of capital should I risk per trade
// to maximise long-run growth without blowing up?"
//
//   f* = W/A - (1-W)/B
//
//   W = win probability (win rate)
//   B = average return of a winning trade  (positive fraction, e.g. 0.04 = 4%)
//   A = average loss  of a losing  trade   (positive fraction, e.g. 0.02 = 2%)
//
// Full Kelly is mathematically optimal but very aggressive and sensitive to
// estimation error — a 10% mis-estimate of W can halve your bankroll.
// In practice quant funds use half-Kelly or quarter-Kelly as a safety margin.
//
// Reference: Kelly (1956), Thorp (1969), Vince "Portfolio Management Formulas"

import type { BacktestTrade } from "@/lib/types";

export interface KellyResult {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** Raw Kelly fraction. Aggressive — for reference only. */
  kellyFull: number;
  /** Half-Kelly: recommended for live trading. */
  kellyHalf: number;
  /** Quarter-Kelly: conservative, for first live trades. */
  kellyQuarter: number;
  /** Tier label based on half-Kelly. */
  tier: "strong" | "moderate" | "weak" | "insufficient";
}

/**
 * Compute Kelly sizing from a list of completed backtest trades.
 * Returns null if there are too few trades to estimate reliably.
 */
export function computeKelly(trades: BacktestTrade[]): KellyResult | null {
  if (trades.length < 10) return null;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  if (wins.length === 0 || losses.length === 0) return null;

  const W = wins.length / trades.length;
  const B = wins.reduce((s, t) => s + t.pnl, 0) / wins.length;    // avg win
  const A = Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length); // avg loss (positive)

  if (A <= 0 || B <= 0) return null;

  // Kelly formula: f* = W/A - (1-W)/B
  const kellyFull = Math.max(0, W / A - (1 - W) / B);
  const kellyHalf = kellyFull / 2;
  const kellyQuarter = kellyFull / 4;

  const tier: KellyResult["tier"] =
    kellyHalf <= 0       ? "insufficient" :
    kellyHalf >= 0.05    ? "strong"       :
    kellyHalf >= 0.02    ? "moderate"     :
                           "weak";

  return { winRate: W, avgWin: B, avgLoss: A, kellyFull, kellyHalf, kellyQuarter, tier };
}
