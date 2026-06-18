// Auto-trader executor.
//
// Reads stored pairs + open positions, computes the current z-score for each,
// then opens new spread positions on entry signals and flattens open ones on
// exit / stop / time-stop. Orders route through lib/exec/bybit.ts on Bybit USDT
// Perpetuals. In "paper" mode no orders are sent — intended fills are simulated
// at the latest close so the logic can be validated risk-free.
//
// Safety model:
//   • Master kill switch (config.tradingEnabled) — default OFF.
//   • Per-trade risk = config.riskPerTrade of equity to the stop.
//   • Gross notional capped to config.maxNotionalFraction × equity.
//   • Max concurrent positions enforced.
//   • paper / testnet / live rows are kept separate in the DB.

import { config } from "@/lib/config";
import { fetchAlignedCloses } from "@/lib/data/exchange";
import { buildSpreadSeries } from "@/lib/engine/signals";
import { detectRegime } from "@/lib/engine/regime";
import { backtestPair } from "@/lib/engine/backtest";
import { engleGranger } from "@/lib/stats/cointegration";
import { rollingStd } from "@/lib/stats/zscore";
import { sizeLogSpreadPosition } from "@/lib/risk/sizing";
import {
  getPairs,
  getOpenPositions,
  getRealizedPnlSince,
  openPosition,
  closePosition,
  pairKey,
} from "@/lib/db/supabase";
import { sendTelegramMessage } from "@/lib/alert/telegram";
import {
  getEquity,
  getInstrumentInfo,
  roundQty,
  setLeverage,
  placeMarketOrder,
  placeMarketOrderConfirmed,
  getOpenPerpPositions,
  toBybitSymbol,
  type OrderSide,
  type OrderFill,
  type BybitPosition,
} from "./bybit";
import type { Position, TradingMode } from "@/lib/types";

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "12h": 43_200_000, "1d": 86_400_000,
};

export interface ExecAction {
  pair: string;
  action: "open" | "close" | "skip";
  side?: string;
  reason: string;
  qtyA?: number;
  qtyB?: number;
  z?: number;
}

export interface ExecSummary {
  enabled: boolean;
  mode: TradingMode;
  equity: number;
  openBefore: number;
  opened: number;
  closed: number;
  /** How many candidate pairs were scanned for a new entry this cycle. */
  evaluated: number;
  /** The most-stretched pair right now (highest |z|), for at-a-glance health. */
  nearestEntry: { pair: string; z: number } | null;
  /** Realized-today + open-unrealized PnL estimate (USDT) for the breaker. */
  dayPnl: number;
  /** True when the daily-loss circuit breaker blocked new entries this cycle. */
  haltedDailyLoss: boolean;
  /** Reconciliation / safety warnings raised this cycle (drift, partial fills). */
  warnings: string[];
  actions: ExecAction[];
}

/** Latest finite value of a rolling-std series. */
function latestStd(spread: number[], window: number): number {
  const sd = rollingStd(spread, window);
  for (let i = sd.length - 1; i >= 0; i--) {
    if (Number.isFinite(sd[i]) && sd[i] > 0) return sd[i];
  }
  return NaN;
}

/** Order sides to OPEN a spread position. */
function openSides(side: Position["side"]): { a: OrderSide; b: OrderSide } {
  return side === "LONG_SPREAD"
    ? { a: "Buy", b: "Sell" } // long A, short B
    : { a: "Sell", b: "Buy" }; // short A, long B
}

/** Net USDT P&L of a closed position (incl. approximate round-trip fees). */
function realizedPnl(p: Position, exitA: number, exitB: number): number {
  const longA = p.side === "LONG_SPREAD";
  const pnlA = longA ? p.qty_a * (exitA - p.entry_price_a) : p.qty_a * (p.entry_price_a - exitA);
  const pnlB = longA ? p.qty_b * (p.entry_price_b - exitB) : p.qty_b * (exitB - p.entry_price_b);
  const entryNotional = p.qty_a * p.entry_price_a + p.qty_b * p.entry_price_b;
  const exitNotional = p.qty_a * exitA + p.qty_b * exitB;
  const fees = config.feePerLeg * (entryNotional + exitNotional);
  return pnlA + pnlB - fees;
}

/** Reverse of an order side, for flattening / rollback. */
function reverse(side: OrderSide): OrderSide {
  return side === "Buy" ? "Sell" : "Buy";
}

/**
 * Open both legs atomically-ish. Leg A fills first; if leg B then fails, leg A
 * is rolled back (reduce-only) so we never hold naked one-sided exposure — the
 * single most dangerous failure mode in pairs trading. Throws if leg A can't be
 * opened (no exposure created) or if rollback itself fails (manual fix needed).
 */
async function openLegsSafely(
  symbolA: string, sideA: OrderSide, qtyA: number,
  symbolB: string, sideB: OrderSide, qtyB: number,
): Promise<{ fillA: OrderFill; fillB: OrderFill }> {
  const fillA = await placeMarketOrderConfirmed({ symbol: symbolA, side: sideA, qty: qtyA });
  try {
    const fillB = await placeMarketOrderConfirmed({ symbol: symbolB, side: sideB, qty: qtyB });
    return { fillA, fillB };
  } catch (e) {
    try {
      await placeMarketOrder({
        symbol: symbolA, side: reverse(sideA), qty: fillA.filledQty, reduceOnly: true,
      });
    } catch (rb) {
      throw new Error(
        `leg B failed (${(e as Error).message}) AND rollback of leg A FAILED ` +
          `(${(rb as Error).message}) — NAKED ${symbolA} POSITION, MANUAL ACTION NEEDED`,
      );
    }
    throw new Error(`leg B failed, leg A rolled back: ${(e as Error).message}`);
  }
}

/** Close one leg reduce-only, returning the realized fill (null if it failed). */
async function closeLegSafely(
  symbol: string, exitSide: OrderSide, qty: number,
): Promise<OrderFill | null> {
  try {
    return await placeMarketOrderConfirmed({ symbol, side: exitSide, qty, reduceOnly: true });
  } catch {
    return null;
  }
}

/**
 * Run one execution cycle. Pure orchestration — every external effect (orders,
 * DB writes, alerts) is guarded by the trading mode.
 */
export async function runExecutor(): Promise<ExecSummary> {
  const mode = config.tradingMode;
  const actions: ExecAction[] = [];
  const warnings: string[] = [];

  let evaluated = 0;
  let nearestEntry: { pair: string; z: number } | null = null;

  if (!config.tradingEnabled) {
    return { enabled: false, mode, equity: 0, openBefore: 0, opened: 0, closed: 0, evaluated, nearestEntry, dayPnl: 0, haltedDailyLoss: false, warnings, actions };
  }

  const pairs = (await getPairs(100)).filter((p) => p.cointegrated);
  const openPositions = await getOpenPositions(mode);
  const openKeys = new Set(openPositions.map((p) => pairKey(p.symbol_a, p.symbol_b)));

  // Symbols we need prices for: every pair leg + every open position leg.
  const symbols = Array.from(
    new Set([
      ...pairs.flatMap((p) => [p.symbol_a, p.symbol_b]),
      ...openPositions.flatMap((p) => [p.symbol_a, p.symbol_b]),
    ]),
  );
  if (symbols.length === 0) {
    return { enabled: true, mode, equity: 0, openBefore: 0, opened: 0, closed: 0, evaluated, nearestEntry, dayPnl: 0, haltedDailyLoss: false, warnings, actions };
  }

  const lookback = Math.max(config.zscoreWindow + 50, 200);
  const matrix = await fetchAlignedCloses(symbols, config.timeframe, lookback);
  const idx = new Map(matrix.symbols.map((s, i) => [s, i] as const));

  const equity = mode === "paper" ? config.paperEquity : await getEquity();

  // ── Reconcile DB ↔ exchange (live/testnet only) ─────────────────────────────
  // The DB is our source of truth for *intent*; Bybit is the truth for *reality*.
  // If they drift (executor crashed mid-cycle, a leg was liquidated, a manual
  // close happened) we must not blindly send orders against a stale view.
  const liveBySym = new Map<string, BybitPosition>();
  if (mode !== "paper") {
    try {
      for (const p of await getOpenPerpPositions()) liveBySym.set(p.symbol, p);
    } catch (e) {
      warnings.push(`could not fetch exchange positions for reconciliation: ${(e as Error).message}`);
    }
  }
  /** Live exchange size for a leg (0 if flat / unknown). */
  const liveSize = (symbol: string): number => liveBySym.get(toBybitSymbol(symbol))?.size ?? 0;

  let opened = 0;
  let closed = 0;

  // ── Daily-loss circuit breaker bookkeeping ──────────────────────────────────
  // dayPnl = realized PnL since UTC midnight + PnL booked this cycle + current
  // open (unrealized) PnL. If it breaches the limit we stop opening new risk.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  let realizedToday = 0;
  try {
    realizedToday = await getRealizedPnlSince(mode, dayStart.toISOString());
  } catch (e) {
    warnings.push(`could not read today's realized PnL: ${(e as Error).message}`);
  }
  let realizedThisCycle = 0;
  let unrealizedPnl = 0;

  // ── 1. Manage OPEN positions: close on break / exit / stop / time-stop ───────
  for (const pos of openPositions) {
    const ia = idx.get(pos.symbol_a);
    const ib = idx.get(pos.symbol_b);
    const key = pairKey(pos.symbol_a, pos.symbol_b);
    if (ia === undefined || ib === undefined) {
      actions.push({ pair: key, action: "skip", reason: "no price data for leg" });
      continue;
    }

    const { zscore } = buildSpreadSeries(matrix.closes[ia], matrix.closes[ib], {
      useKalman: true,
      window: config.zscoreWindow,
    });
    const z = zscore[zscore.length - 1];
    const priceA = matrix.closes[ia][matrix.closes[ia].length - 1];
    const priceB = matrix.closes[ib][matrix.closes[ib].length - 1];

    const tfMs = TIMEFRAME_MS[config.timeframe] ?? 3_600_000;
    const barsHeld = pos.opened_at ? (Date.now() - new Date(pos.opened_at).getTime()) / tfMs : 0;

    // Structural-break re-test: has the pair stopped cointegrating since entry?
    // Run on the live log-price window; if it has broken, exit takes priority.
    let breakP = NaN;
    if (config.adfRetestLive) {
      try {
        breakP = engleGranger(
          matrix.closes[ia].map((v) => Math.log(v)),
          matrix.closes[ib].map((v) => Math.log(v)),
        ).pValue;
      } catch {
        // Treat an un-computable re-test as "unknown" — don't force a close.
      }
    }

    let reason: string | null = null;
    if (Number.isFinite(breakP) && breakP > config.adfPValueMax) {
      reason = `structural break (cointegration p=${breakP.toFixed(3)} > ${config.adfPValueMax})`;
    } else if (Number.isFinite(z) && Math.abs(z) > config.stopThreshold) {
      reason = "stop (z beyond stop threshold)";
    } else if (Number.isFinite(z) && Math.abs(z) < config.exitThreshold) {
      reason = "exit (mean reverted)";
    } else if (Number.isFinite(pos.half_life) && barsHeld > 2 * pos.half_life) {
      reason = "time stop (>2× half-life)";
    }

    if (!reason) {
      // Held: contribute current mark-to-market to the daily-loss breaker.
      if (Number.isFinite(priceA) && Number.isFinite(priceB)) {
        unrealizedPnl += realizedPnl(pos, priceA, priceB);
      }
      actions.push({ pair: key, action: "skip", reason: "holding", z });
      continue;
    }

    // Flatten both legs (reverse of entry, reduce-only). Default exit prices to
    // the latest close; overwrite with the real average fill when we have it.
    const entry = openSides(pos.side);
    let exitPriceA = priceA;
    let exitPriceB = priceB;
    try {
      if (mode !== "paper") {
        const liveA = liveSize(pos.symbol_a);
        const liveB = liveSize(pos.symbol_b);

        if (liveA <= 0 && liveB <= 0) {
          // Orphan: DB says open but the exchange is flat (manual close, a
          // liquidation, or a crash before the DB write). Reconcile the row
          // without sending any orders.
          warnings.push(`${key}: orphan DB position (flat on exchange) — closing row, no orders sent`);
        } else {
          const fillA = liveA > 0 ? await closeLegSafely(pos.symbol_a, reverse(entry.a), pos.qty_a) : null;
          const fillB = liveB > 0 ? await closeLegSafely(pos.symbol_b, reverse(entry.b), pos.qty_b) : null;

          const failedLegs = [
            liveA > 0 && !fillA ? "leg A" : null,
            liveB > 0 && !fillB ? "leg B" : null,
          ].filter(Boolean);
          if (failedLegs.length > 0) {
            // A leg that exists on the exchange could not be flattened. Leave the
            // DB row OPEN so the next cycle retries; never mark it closed while
            // real exposure remains.
            const msg = `${key}: close FAILED on ${failedLegs.join(" & ")} — residual exposure, will retry next cycle`;
            warnings.push(msg);
            actions.push({ pair: key, action: "skip", reason: msg, z });
            await sendTelegramMessage(`⚠️ *CLOSE FAILED* (${mode})\n${msg}`);
            continue;
          }
          if (fillA?.avgPrice) exitPriceA = fillA.avgPrice;
          if (fillB?.avgPrice) exitPriceB = fillB.avgPrice;
        }
      }
      const pnl = realizedPnl(pos, exitPriceA, exitPriceB);
      await closePosition(pos.id!, {
        exit_price_a: exitPriceA,
        exit_price_b: exitPriceB,
        exit_z: Number.isFinite(z) ? z : 0,
        exit_reason: reason,
        pnl,
      });
      closed++;
      realizedThisCycle += pnl;
      actions.push({ pair: key, action: "close", side: pos.side, reason, z });
      await sendTelegramMessage(
        `🔻 *CLOSE* \`${pos.symbol_a}\`/\`${pos.symbol_b}\` (${mode})\n${reason}\nz=${z.toFixed(2)}  PnL≈${pnl.toFixed(2)} USDT`,
      );
    } catch (e) {
      actions.push({ pair: key, action: "skip", reason: `close failed: ${(e as Error).message}` });
    }
  }

  // ── Daily-loss circuit breaker decision ─────────────────────────────────────
  const dayPnl = realizedToday + realizedThisCycle + unrealizedPnl;
  const lossLimit = config.maxDailyLossFraction > 0 ? -config.maxDailyLossFraction * equity : -Infinity;
  const haltedDailyLoss = dayPnl <= lossLimit;
  if (haltedDailyLoss) {
    const msg =
      `daily-loss circuit breaker: dayPnl≈${dayPnl.toFixed(2)} ≤ ${lossLimit.toFixed(2)} USDT ` +
      `(${(config.maxDailyLossFraction * 100).toFixed(1)}% of equity) — no new entries this cycle`;
    warnings.push(msg);
    await sendTelegramMessage(`🛑 *CIRCUIT BREAKER* (${mode})\n${msg}`);
  }

  // ── 2. Open NEW positions on entry signals (respecting capacity) ────────────
  let liveCount = openPositions.length - closed;
  for (const pair of pairs) {
    if (haltedDailyLoss) break;
    if (liveCount >= config.maxConcurrentPositions) break;
    const key = pairKey(pair.symbol_a, pair.symbol_b);
    if (openKeys.has(key)) continue; // already in a position

    const ia = idx.get(pair.symbol_a);
    const ib = idx.get(pair.symbol_b);
    if (ia === undefined || ib === undefined) continue;

    const { spread, zscore } = buildSpreadSeries(matrix.closes[ia], matrix.closes[ib], {
      useKalman: true,
      window: config.zscoreWindow,
    });
    const z = zscore[zscore.length - 1];
    if (!Number.isFinite(z)) continue;

    // We have a usable z for this candidate — record it for observability.
    evaluated++;
    const az = Math.abs(z);
    if (!nearestEntry || az > Math.abs(nearestEntry.z)) nearestEntry = { pair: key, z };

    // Entry only inside the band: beyond entry but not past the stop.
    if (az < config.entryThreshold || az > config.stopThreshold) continue;

    // Regime guard: don't open into a dangerous regime (vol spike / trending /
    // structural break). Existing positions are still managed above.
    if (config.regimeFilterLive) {
      const regime = detectRegime(spread, zscore);
      if (regime.label === "DANGER") {
        actions.push({
          pair: key,
          action: "skip",
          reason: `regime DANGER — ${regime.warnings[0] ?? "skip new entry"}`,
          z,
        });
        continue;
      }
    }

    // Entry-quality gate: backtest this pair on the live window and require the
    // strategy to be at least break-even recently. Blocks cointegrated-but-
    // unprofitable pairs. Set MIN_ENTRY_SHARPE to a large negative to disable.
    if (config.minEntrySharpe > -90) {
      const bt = backtestPair(pair.symbol_a, pair.symbol_b, matrix.closes[ia], matrix.closes[ib]);
      if (bt.metrics.sharpe < config.minEntrySharpe) {
        actions.push({
          pair: key,
          action: "skip",
          reason: `entry gate: recent Sharpe ${bt.metrics.sharpe.toFixed(2)} < ${config.minEntrySharpe} (${bt.metrics.totalTrades} trades)`,
          z,
        });
        continue;
      }
    }

    const side: Position["side"] = z > 0 ? "SHORT_SPREAD" : "LONG_SPREAD";

    const priceA = matrix.closes[ia][matrix.closes[ia].length - 1];
    const priceB = matrix.closes[ib][matrix.closes[ib].length - 1];

    // Size so that a move from the entry band to the stop band loses ~risk.
    // Spread (and pair.beta) are in log space, so use the log-aware sizer.
    const spreadStd = latestStd(spread, config.zscoreWindow);
    if (!Number.isFinite(spreadStd) || spreadStd <= 0) continue;
    const logSpreadStopDistance = (config.stopThreshold - config.entryThreshold) * spreadStd;

    const sizing = sizeLogSpreadPosition({
      equity,
      priceA,
      priceB,
      beta: pair.beta,
      logSpreadStopDistance,
    });

    // Cap gross notional → bounds effective leverage.
    let { unitsA, unitsB } = sizing;
    const maxGross = config.maxNotionalFraction * equity;
    if (sizing.grossNotional > maxGross && sizing.grossNotional > 0) {
      const scale = maxGross / sizing.grossNotional;
      unitsA *= scale;
      unitsB *= scale;
    }

    // Round to instrument lot sizes and validate minimums.
    const infoA = await getInstrumentInfo(pair.symbol_a);
    const infoB = await getInstrumentInfo(pair.symbol_b);
    if (!infoA || !infoB) {
      actions.push({ pair: key, action: "skip", reason: "instrument info unavailable", z });
      continue;
    }
    const qtyA = roundQty(unitsA, infoA.qtyStep);
    const qtyB = roundQty(unitsB, infoB.qtyStep);

    const okA = qtyA >= infoA.minQty && qtyA * priceA >= Math.max(config.minOrderNotional, infoA.minNotional);
    const okB = qtyB >= infoB.minQty && qtyB * priceB >= Math.max(config.minOrderNotional, infoB.minNotional);
    if (!okA || !okB) {
      actions.push({
        pair: key,
        action: "skip",
        reason: `below min size (qtyA=${qtyA}, qtyB=${qtyB}) — equity too small or notional cap too tight`,
        z,
      });
      continue;
    }

    // Reconciliation guard: never stack onto a leg that already has live
    // exposure on the exchange (an orphan position, or a leg shared with
    // another pair). Stacking would break the hedge ratio and risk sizing.
    if (mode !== "paper" && (liveSize(pair.symbol_a) > 0 || liveSize(pair.symbol_b) > 0)) {
      const msg = `${key}: a leg already has live exchange exposure — skipping to avoid stacking`;
      warnings.push(msg);
      actions.push({ pair: key, action: "skip", reason: msg, z });
      continue;
    }

    const sides = openSides(side);
    try {
      // Default to intended qty/price; overwrite with realized fills (live mode).
      let fillQtyA = qtyA;
      let fillQtyB = qtyB;
      let entryPriceA = priceA;
      let entryPriceB = priceB;
      if (mode !== "paper") {
        await setLeverage(pair.symbol_a, config.leverage);
        await setLeverage(pair.symbol_b, config.leverage);
        const { fillA, fillB } = await openLegsSafely(
          pair.symbol_a, sides.a, qtyA,
          pair.symbol_b, sides.b, qtyB,
        );
        fillQtyA = fillA.filledQty;
        fillQtyB = fillB.filledQty;
        if (fillA.avgPrice) entryPriceA = fillA.avgPrice;
        if (fillB.avgPrice) entryPriceB = fillB.avgPrice;
      }
      const stored: Position = {
        symbol_a: pair.symbol_a,
        symbol_b: pair.symbol_b,
        side,
        qty_a: fillQtyA,
        qty_b: fillQtyB,
        entry_price_a: entryPriceA,
        entry_price_b: entryPriceB,
        entry_z: z,
        beta: pair.beta,
        half_life: pair.half_life,
        status: "open",
        mode,
      };
      await openPosition(stored);
      opened++;
      liveCount++;
      openKeys.add(key);
      actions.push({ pair: key, action: "open", side, reason: "entry signal", qtyA: fillQtyA, qtyB: fillQtyB, z });
      await sendTelegramMessage(
        `🟢 *OPEN ${side}* \`${pair.symbol_a}\`/\`${pair.symbol_b}\` (${mode})\n` +
          `z=${z.toFixed(2)}  qtyA=${fillQtyA}  qtyB=${fillQtyB}\n` +
          `entryA=${entryPriceA}  entryB=${entryPriceB}`,
      );
    } catch (e) {
      // openLegsSafely throws AFTER rolling leg A back, so no naked exposure
      // remains here (unless rollback itself failed — its message says so).
      const msg = `open failed: ${(e as Error).message}`;
      warnings.push(`${key}: ${msg}`);
      actions.push({ pair: key, action: "skip", reason: msg, z });
      if (mode !== "paper") await sendTelegramMessage(`⚠️ *OPEN FAILED* (${mode})\n${key}: ${(e as Error).message}`);
    }
  }

  return {
    enabled: true,
    mode,
    equity,
    openBefore: openPositions.length,
    opened,
    closed,
    evaluated,
    nearestEntry,
    dayPnl,
    haltedDailyLoss,
    warnings,
    actions,
  };
}
