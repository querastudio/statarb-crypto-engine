// Walk-forward validation: splits the backtest OOS period into N equal,
// non-overlapping folds and reports per-fold performance.
//
// This answers the critical question: "Is the strategy consistently profitable
// across different time periods, or did it just get lucky in one stretch?"
//
// Implementation note: because the backtest uses rolling z-scores and a
// recursive Kalman filter (both causal — no look-ahead), the signal stream
// is already walk-forward safe. We only need to *partition* the existing
// equity curve to extract per-fold performance.

import type { BacktestResult, WalkForwardFold, WalkForwardResult } from "@/lib/types";

const BARS_PER_YEAR_1H = 365 * 24;

function foldMetrics(
  equityCurve: BacktestResult["equityCurve"],
  trades: BacktestResult["trades"],
  startBar: number,
  endBar: number,
): Omit<WalkForwardFold, "label" | "startBar" | "endBar"> {
  // Per-bar returns from the equity curve slice.
  const barReturns: number[] = [];
  for (let i = startBar; i <= endBar; i++) {
    const prev = equityCurve[i - 1]?.equity ?? equityCurve[i].equity;
    const curr = equityCurve[i].equity;
    barReturns.push(prev > 0 ? curr / prev - 1 : 0);
  }

  // Total return: ratio of equity at fold end vs fold start.
  const startEquity = equityCurve[Math.max(0, startBar - 1)]?.equity ?? 1;
  const endEquity = equityCurve[endBar].equity;
  const totalReturn = startEquity > 0 ? endEquity / startEquity - 1 : 0;

  // Annualised Sharpe.
  const n = barReturns.length;
  const mu = n > 0 ? barReturns.reduce((s, r) => s + r, 0) / n : 0;
  const variance =
    n > 1 ? barReturns.reduce((s, r) => s + (r - mu) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 1e-10 ? (mu / sd) * Math.sqrt(BARS_PER_YEAR_1H) : 0;

  // Max drawdown within the fold.
  let peak = startEquity;
  let maxDrawdown = 0;
  for (let i = startBar; i <= endBar; i++) {
    const eq = equityCurve[i].equity;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Trades whose ENTRY falls within this fold.
  const foldTrades = trades.filter(
    (t) => t.entryIndex >= startBar && t.entryIndex <= endBar,
  );
  const wins = foldTrades.filter((t) => t.pnl > 0).length;
  const winRate = foldTrades.length > 0 ? wins / foldTrades.length : 0;

  return { totalReturn, sharpe, maxDrawdown, totalTrades: foldTrades.length, winRate };
}

/**
 * Partition the OOS portion of a finished backtest into `nFolds` equal slices
 * and return per-fold + aggregate walk-forward statistics.
 */
export function walkForward(
  result: BacktestResult,
  nFolds = 4,
): WalkForwardResult {
  const { equityCurve, trades, oosStartIndex } = result;
  const n = equityCurve.length;
  const oosLength = n - oosStartIndex;

  // Ensure we have at least 10 bars per fold.
  const effectiveFolds = Math.min(nFolds, Math.max(1, Math.floor(oosLength / 10)));
  const foldSize = Math.floor(oosLength / effectiveFolds);

  const folds: WalkForwardFold[] = [];

  for (let f = 0; f < effectiveFolds; f++) {
    const startBar = oosStartIndex + f * foldSize;
    const endBar =
      f === effectiveFolds - 1
        ? n - 1
        : oosStartIndex + (f + 1) * foldSize - 1;

    const metrics = foldMetrics(equityCurve, trades, startBar, endBar);

    folds.push({
      label: `Periode ${f + 1}`,
      startBar,
      endBar,
      ...metrics,
    });
  }

  const profitable = folds.filter((f) => f.totalReturn > 0).length;
  const consistencyPct = folds.length > 0 ? profitable / folds.length : 0;
  const avgSharpe = folds.length > 0
    ? folds.reduce((s, f) => s + f.sharpe, 0) / folds.length
    : 0;
  const avgReturn = folds.length > 0
    ? folds.reduce((s, f) => s + f.totalReturn, 0) / folds.length
    : 0;

  return {
    folds,
    consistencyPct,
    avgSharpe,
    avgReturn,
    isRobust: consistencyPct >= 0.6 && avgSharpe > 0.5,
  };
}
