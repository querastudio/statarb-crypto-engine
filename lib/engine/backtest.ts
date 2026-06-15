// Event-driven backtest for a single pair's spread strategy.
//
// Models realistic costs (taker fee per leg + slippage, charged on entry and
// exit of both legs), produces an equity curve (mark-to-market), and reports
// after-cost vs before-cost metrics plus an out-of-sample slice.
//
// Trade convention (spread = price_A - beta·price_B):
//   LONG_SPREAD  → profit when spread rises   (enter when z < -entry)
//   SHORT_SPREAD → profit when spread falls    (enter when z > +entry)

import { config } from "@/lib/config";
import { buildSpreadSeries } from "./signals";
import { halfLife } from "@/lib/stats/halflife";
import type {
  BacktestMetrics,
  BacktestParams,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
} from "@/lib/types";

const DEFAULT_PARAMS: BacktestParams = {
  zscoreWindow: config.zscoreWindow,
  entryThreshold: config.entryThreshold,
  exitThreshold: config.exitThreshold,
  stopThreshold: config.stopThreshold,
  feePerLeg: config.feePerLeg,
  slippage: config.slippage,
  useKalman: true,
  trainFraction: 0.7,
};

/** Approximate number of bars per year for the configured timeframe. */
function barsPerYear(timeframe: string): number {
  const m = timeframe.match(/^(\d+)([mhdwM])$/);
  if (!m) return 365 * 24; // default: hourly
  const value = Number(m[1]);
  const unit = m[2];
  const minutesPer: Record<string, number> = {
    m: 1,
    h: 60,
    d: 60 * 24,
    w: 60 * 24 * 7,
    M: 60 * 24 * 30,
  };
  const barMinutes = value * (minutesPer[unit] ?? 60);
  return (365 * 24 * 60) / barMinutes;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

/** Compute aggregate metrics from per-bar returns and the trade list. */
function computeMetrics(
  barReturns: number[],
  trades: BacktestTrade[],
  periodsPerYear: number,
  net: boolean,
): BacktestMetrics {
  const pnls = trades.map((t) => (net ? t.pnl : t.grossPnl));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);

  const grossProfit = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));

  const mu = mean(barReturns);
  const sd = std(barReturns);
  const sharpe = sd > 0 ? (mu / sd) * Math.sqrt(periodsPerYear) : 0;

  const downside = barReturns.filter((r) => r < 0);
  const dsd = std(downside.length > 1 ? downside : [0, 0]);
  // Cap Sortino at 999: when there are almost no losing bars, dsd → 0 causing
  // division-by-near-zero that produces astronomical values (not meaningful).
  const sortinoRaw = dsd > 1e-10 ? (mu / dsd) * Math.sqrt(periodsPerYear) : 999;
  const sortino = Math.min(sortinoRaw, 999);

  // Equity curve from compounding bar returns → max drawdown.
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of barReturns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const totalReturn = equity - 1;

  const durations = trades.map((t) => t.bars);

  return {
    totalTrades: trades.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    sharpe,
    sortino,
    maxDrawdown: maxDd,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgTradeDurationBars: durations.length > 0 ? mean(durations) : 0,
    totalReturn,
    totalReturnGross: totalReturn,
  };
}

/**
 * Run the backtest. `priceA`/`priceB` are aligned close prices, `timestamps`
 * is the matching unix-ms array (optional; defaults to bar index).
 */
export function backtestPair(
  symbolA: string,
  symbolB: string,
  priceA: number[],
  priceB: number[],
  timestamps?: number[],
  overrides: Partial<BacktestParams> = {},
): BacktestResult {
  const params: BacktestParams = { ...DEFAULT_PARAMS, ...overrides };
  const n = priceA.length;
  const ts = timestamps ?? priceA.map((_, i) => i);

  const { beta, spread, zscore } = buildSpreadSeries(priceA, priceB, {
    useKalman: params.useKalman,
    window: params.zscoreWindow,
  });

  // Time-stop: close if position hasn't converged after 2x half-life.
  // The Kalman spread adapts quickly so raw half-life can be < 1 bar —
  // enforce a minimum of 5 bars so the strategy gets a fair chance to work.
  const hl = halfLife(spread);
  const timeStopBars = Number.isFinite(hl) ? Math.max(5, Math.ceil(2 * hl)) : Infinity;

  const costRate = 2 * (params.feePerLeg + params.slippage); // entry+exit, both legs

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const barReturns: number[] = []; // net per-bar returns
  const barReturnsOOS: number[] = [];

  const oosStartIndex = Math.floor(n * params.trainFraction);

  // Position state.
  let position = 0; // +1 long spread, -1 short spread, 0 flat
  let entryIndex = -1;
  let entrySpread = 0;
  let entryNotional = 1;
  let entryZ = 0;

  let equity = 1; // net, compounding
  let equityGross = 1;

  const closeTrade = (i: number, reason: BacktestTrade["exitReason"]) => {
    const direction = position;
    const grossMove = (direction * (spread[i] - entrySpread)) / entryNotional;
    const net = grossMove - costRate;
    trades.push({
      side: direction > 0 ? "LONG_SPREAD" : "SHORT_SPREAD",
      entryIndex,
      exitIndex: i,
      entryTime: ts[entryIndex],
      exitTime: ts[i],
      entryZ,
      exitZ: zscore[i],
      pnl: net,
      grossPnl: grossMove,
      bars: i - entryIndex,
      exitReason: reason,
    });
    position = 0;
  };

  for (let i = 0; i < n; i++) {
    const z = zscore[i];
    let prevEquity = equity;
    let prevEquityGross = equityGross;

    if (Number.isFinite(z)) {
      if (position === 0) {
        // Entry rules.
        if (z > params.entryThreshold) {
          position = -1; // short spread
        } else if (z < -params.entryThreshold) {
          position = 1; // long spread
        }
        if (position !== 0) {
          entryIndex = i;
          entrySpread = spread[i];
          entryNotional = Math.abs(priceA[i]) + Math.abs(beta[i] * priceB[i]);
          if (entryNotional <= 0) entryNotional = 1;
          entryZ = z;
          // Pay entry cost immediately (half of round-trip).
          const entryCost = (params.feePerLeg + params.slippage);
          equity *= 1 - entryCost;
          // gross unaffected by cost
        }
      } else {
        // Manage open position: mark-to-market this bar.
        const direction = position;
        const barPnl =
          (direction * (spread[i] - spread[i - 1])) / entryNotional;
        equity *= 1 + barPnl;
        equityGross *= 1 + barPnl;

        const heldBars = i - entryIndex;
        const az = Math.abs(z);
        if (az > params.stopThreshold) {
          closeTrade(i, "stop");
          equity *= 1 - (params.feePerLeg + params.slippage); // exit cost
        } else if (az < params.exitThreshold) {
          closeTrade(i, "exit");
          equity *= 1 - (params.feePerLeg + params.slippage);
        } else if (heldBars >= timeStopBars) {
          closeTrade(i, "time");
          equity *= 1 - (params.feePerLeg + params.slippage);
        }
      }
    }

    // Force-close any open position on the final bar.
    if (i === n - 1 && position !== 0) {
      closeTrade(i, "end");
      equity *= 1 - (params.feePerLeg + params.slippage);
    }

    const netBarReturn = prevEquity > 0 ? equity / prevEquity - 1 : 0;
    const grossBarReturn = prevEquityGross > 0 ? equityGross / prevEquityGross - 1 : 0;
    barReturns.push(netBarReturn);
    void grossBarReturn;
    if (i >= oosStartIndex) barReturnsOOS.push(netBarReturn);

    equityCurve.push({
      index: i,
      timestamp: ts[i],
      equity,
      equityGross,
      zscore: Number.isFinite(z) ? z : 0,
    });
  }

  const ppy = barsPerYear(config.timeframe);
  const oosTrades = trades.filter((t) => t.entryIndex >= oosStartIndex);

  const metrics = computeMetrics(barReturns, trades, ppy, true);
  const metricsGross = computeMetrics(barReturns, trades, ppy, false);
  // Gross total return uses the gross equity path.
  metricsGross.totalReturn = equityGross - 1;
  metrics.totalReturnGross = equityGross - 1;
  const metricsOOS = computeMetrics(barReturnsOOS, oosTrades, ppy, true);

  return {
    symbol_a: symbolA,
    symbol_b: symbolB,
    metrics,
    metricsGross,
    metricsOOS,
    oosStartIndex,
    trades,
    equityCurve,
    params,
  };
}
