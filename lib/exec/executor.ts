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
import { rollingStd } from "@/lib/stats/zscore";
import { sizePosition } from "@/lib/risk/sizing";
import {
  getPairs,
  getOpenPositions,
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
  type OrderSide,
} from "./bybit";
import type { Pair, Position, TradingMode } from "@/lib/types";

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

/**
 * Run one execution cycle. Pure orchestration — every external effect (orders,
 * DB writes, alerts) is guarded by the trading mode.
 */
export async function runExecutor(): Promise<ExecSummary> {
  const mode = config.tradingMode;
  const actions: ExecAction[] = [];

  let evaluated = 0;
  let nearestEntry: { pair: string; z: number } | null = null;

  if (!config.tradingEnabled) {
    return { enabled: false, mode, equity: 0, openBefore: 0, opened: 0, closed: 0, evaluated, nearestEntry, actions };
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
    return { enabled: true, mode, equity: 0, openBefore: 0, opened: 0, closed: 0, evaluated, nearestEntry, actions };
  }

  const lookback = Math.max(config.zscoreWindow + 50, 200);
  const matrix = await fetchAlignedCloses(symbols, config.timeframe, lookback);
  const idx = new Map(matrix.symbols.map((s, i) => [s, i] as const));

  const equity = mode === "paper" ? config.paperEquity : await getEquity();

  let opened = 0;
  let closed = 0;

  // ── 1. Manage OPEN positions: close on exit / stop / time-stop ──────────────
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

    let reason: string | null = null;
    if (Number.isFinite(z) && Math.abs(z) > config.stopThreshold) reason = "stop (z beyond stop threshold)";
    else if (Number.isFinite(z) && Math.abs(z) < config.exitThreshold) reason = "exit (mean reverted)";
    else if (Number.isFinite(pos.half_life) && barsHeld > 2 * pos.half_life) reason = "time stop (>2× half-life)";

    if (!reason) {
      actions.push({ pair: key, action: "skip", reason: "holding", z });
      continue;
    }

    // Flatten both legs (reverse of entry, reduce-only).
    const entry = openSides(pos.side);
    try {
      if (mode !== "paper") {
        await placeMarketOrder({ symbol: pos.symbol_a, side: entry.a === "Buy" ? "Sell" : "Buy", qty: pos.qty_a, reduceOnly: true });
        await placeMarketOrder({ symbol: pos.symbol_b, side: entry.b === "Buy" ? "Sell" : "Buy", qty: pos.qty_b, reduceOnly: true });
      }
      const pnl = realizedPnl(pos, priceA, priceB);
      await closePosition(pos.id!, {
        exit_price_a: priceA,
        exit_price_b: priceB,
        exit_z: Number.isFinite(z) ? z : 0,
        exit_reason: reason,
        pnl,
      });
      closed++;
      actions.push({ pair: key, action: "close", side: pos.side, reason, z });
      await sendTelegramMessage(
        `🔻 *CLOSE* \`${pos.symbol_a}\`/\`${pos.symbol_b}\` (${mode})\n${reason}\nz=${z.toFixed(2)}  PnL≈${pnl.toFixed(2)} USDT`,
      );
    } catch (e) {
      actions.push({ pair: key, action: "skip", reason: `close failed: ${(e as Error).message}` });
    }
  }

  // ── 2. Open NEW positions on entry signals (respecting capacity) ────────────
  let liveCount = openPositions.length - closed;
  for (const pair of pairs) {
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

    const side: Position["side"] = z > 0 ? "SHORT_SPREAD" : "LONG_SPREAD";

    const priceA = matrix.closes[ia][matrix.closes[ia].length - 1];
    const priceB = matrix.closes[ib][matrix.closes[ib].length - 1];

    // Size so that a move from the entry band to the stop band loses ~risk.
    const spreadStd = latestStd(spread, config.zscoreWindow);
    if (!Number.isFinite(spreadStd) || spreadStd <= 0) continue;
    const spreadStopDistance = (config.stopThreshold - config.entryThreshold) * spreadStd;

    const sizing = sizePosition({
      equity,
      priceA,
      priceB,
      beta: pair.beta,
      spreadStopDistance,
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

    const sides = openSides(side);
    try {
      if (mode !== "paper") {
        await setLeverage(pair.symbol_a, config.leverage);
        await setLeverage(pair.symbol_b, config.leverage);
        await placeMarketOrder({ symbol: pair.symbol_a, side: sides.a, qty: qtyA });
        await placeMarketOrder({ symbol: pair.symbol_b, side: sides.b, qty: qtyB });
      }
      const stored: Position = {
        symbol_a: pair.symbol_a,
        symbol_b: pair.symbol_b,
        side,
        qty_a: qtyA,
        qty_b: qtyB,
        entry_price_a: priceA,
        entry_price_b: priceB,
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
      actions.push({ pair: key, action: "open", side, reason: "entry signal", qtyA, qtyB, z });
      await sendTelegramMessage(
        `🟢 *OPEN ${side}* \`${pair.symbol_a}\`/\`${pair.symbol_b}\` (${mode})\n` +
          `z=${z.toFixed(2)}  qtyA=${qtyA}  qtyB=${qtyB}\n` +
          `entryA=${priceA}  entryB=${priceB}`,
      );
    } catch (e) {
      actions.push({ pair: key, action: "skip", reason: `open failed: ${(e as Error).message}`, z });
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
    actions,
  };
}
