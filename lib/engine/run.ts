// High-level orchestration used by the cron endpoints. Kept separate from the
// route handlers so the logic is testable and the routes stay thin.

import { config } from "@/lib/config";
import { fetchAlignedCloses, getLiquidUniverse } from "@/lib/data/exchange";
import { discoverPairs } from "./discovery";
// discoverPairs now returns DiscoveryResult (pairs + BH correction stats)
import { generateSignal } from "./signals";
import { getPairs, savePairs, saveSignals, getSignals, getBlacklist, pairKey } from "@/lib/db/supabase";
import { alertSignal } from "@/lib/alert/telegram";
import type { Pair, Signal, SignalSide } from "@/lib/types";

export interface ScanSummary {
  rawUniverseSize: number;
  universeSize: number;
  alignedBars: number;
  pairsFound: number;
  topPairs: Pair[];
  saved: boolean;
  saveError?: string;
  // BH correction stats
  candidatesBeforeBH: number;
  droppedByBH: number;
  bhThreshold: number;
  /** True when pairs come from the non-FDR fallback (BH yielded none). */
  usedFallback: boolean;
}

// Use a shorter lookback for scan so each symbol fits in a single OKX page
// (300 max). 150 bars is plenty for ADF + Hurst and avoids pagination that
// hammers rate limits when 30 symbols fire in parallel.
const SCAN_LOOKBACK = 150;

/**
 * Full pair-discovery scan: fetch liquid universe → aligned closes → discover →
 * persist. `maxCombos` bounds the work for serverless time limits.
 */
export async function runScan(maxCombos?: number): Promise<ScanSummary> {
  const universe = await getLiquidUniverse(config.universeSize);
  const rawUniverseSize = universe.length;
  const matrix = await fetchAlignedCloses(universe, config.timeframe, SCAN_LOOKBACK);
  const blacklist = new Set(await getBlacklist());

  const result = discoverPairs(matrix, { maxCombos });
  const pairs = result.pairs.filter(
    (p) => !blacklist.has(pairKey(p.symbol_a, p.symbol_b)),
  );

  let saved = false;
  let saveError: string | undefined;
  try {
    await savePairs(pairs);
    saved = true;
  } catch (e) {
    saved = false;
    saveError = (e as Error).message;
  }

  return {
    rawUniverseSize,
    universeSize: matrix.symbols.length,
    alignedBars: matrix.timestamps.length,
    pairsFound: pairs.length,
    topPairs: pairs.slice(0, 20),
    saved,
    saveError,
    candidatesBeforeBH: result.candidatesBeforeBH,
    droppedByBH: result.droppedByBH,
    bhThreshold: result.bhThreshold,
    usedFallback: result.usedFallback,
  };
}

export interface SignalRunSummary {
  evaluated: number;
  /** Only the meaningful state transitions (opens, closes, stops, flips). */
  signals: Signal[];
  alertsSent: number;
  /** New entry signals (LONG/SHORT) this run. */
  opened: number;
  /** Exits (CLOSE/STOP) of previously-open pairs this run. */
  closed: number;
}

/** Is this side an open spread position (vs flat)? */
function inPosition(side?: SignalSide): boolean {
  return side === "LONG_SPREAD" || side === "SHORT_SPREAD";
}

/**
 * Evaluate signals for the currently stored pairs and alert ONLY on meaningful
 * state transitions — not on every bar.
 *
 * The classifier is stateless (any pair sitting near z≈0 maps to CLOSE), which
 * otherwise floods Telegram with "CLOSE" for pairs that were never open. We
 * derive each pair's prior state from the most recent persisted signal and
 * alert only when it actually changes:
 *
 *   flat → LONG/SHORT          : OPEN alert
 *   LONG/SHORT → CLOSE         : CLOSE alert (mean reverted)
 *   LONG/SHORT → STOP          : STOP alert (likely structural break)
 *   LONG ↔ SHORT               : FLIP alert (reverse)
 *   everything else (no change): silent, nothing persisted
 *
 * Persisting the transition makes it the new prior state for the next run, so
 * the `signals` table doubles as the state store (no schema change needed).
 */
export async function runSignals(limitPairs = config.maxConcurrentPositions * 3): Promise<SignalRunSummary> {
  const pairs = (await getPairs(limitPairs)).filter((p) => p.cointegrated);

  // Prior state per pair = most-recently persisted signal side (desc by time).
  const priorSide = new Map<string, SignalSide>();
  for (const s of await getSignals(500)) {
    const k = pairKey(s.symbol_a, s.symbol_b);
    if (!priorSide.has(k)) priorSide.set(k, s.side);
  }

  const transitions: Signal[] = [];
  let alertsSent = 0;
  let opened = 0;
  let closed = 0;

  // Batch-fetch the unique symbols we need.
  const symbols = Array.from(new Set(pairs.flatMap((p) => [p.symbol_a, p.symbol_b])));
  const matrix = await fetchAlignedCloses(symbols);
  const idx = new Map(matrix.symbols.map((s, i) => [s, i] as const));

  for (const p of pairs) {
    const ia = idx.get(p.symbol_a);
    const ib = idx.get(p.symbol_b);
    if (ia === undefined || ib === undefined) continue;
    const sig = generateSignal(p.symbol_a, p.symbol_b, matrix.closes[ia], matrix.closes[ib]);
    if (!sig) continue;

    const prev = priorSide.get(pairKey(p.symbol_a, p.symbol_b));
    const cur = sig.side;

    // Decide whether this is a real transition worth alerting on.
    let isOpen = false;
    let isExit = false;
    if (!inPosition(prev)) {
      // Currently flat: only a fresh entry matters. STOP/CLOSE while flat = noise.
      if (cur === "LONG_SPREAD" || cur === "SHORT_SPREAD") isOpen = true;
    } else {
      // Currently in a position: an exit, a stop, or a reversal matters.
      if (cur === "CLOSE" || cur === "STOP") isExit = true;
      else if (inPosition(cur) && cur !== prev) isOpen = true; // flip = new entry
    }
    if (!isOpen && !isExit) continue; // no state change → stay silent

    if (isExit) {
      sig.note = `closing ${prev} — ${cur === "STOP" ? "z beyond stop (possible break)" : "mean reverted"}`;
      closed++;
    } else {
      opened++;
    }

    transitions.push(sig);
    const ok = await alertSignal(sig);
    if (ok) alertsSent++;
  }

  try {
    await saveSignals(transitions);
  } catch {
    // best-effort persistence (also the state store for the next run)
  }

  return { evaluated: pairs.length, signals: transitions, alertsSent, opened, closed };
}
