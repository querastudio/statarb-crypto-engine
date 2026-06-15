// High-level orchestration used by the cron endpoints. Kept separate from the
// route handlers so the logic is testable and the routes stay thin.

import { config } from "@/lib/config";
import { fetchAlignedCloses, getLiquidUniverse } from "@/lib/data/exchange";
import { discoverPairs } from "./discovery";
import { generateSignal } from "./signals";
import { getPairs, savePairs, saveSignals, getBlacklist, pairKey } from "@/lib/db/supabase";
import { alertSignal, isAlertable } from "@/lib/alert/telegram";
import type { Pair, Signal } from "@/lib/types";

export interface ScanSummary {
  universeSize: number;
  alignedBars: number;
  pairsFound: number;
  topPairs: Pair[];
  saved: boolean;
}

/**
 * Full pair-discovery scan: fetch liquid universe → aligned closes → discover →
 * persist. `maxCombos` bounds the work for serverless time limits.
 */
export async function runScan(maxCombos?: number): Promise<ScanSummary> {
  const universe = await getLiquidUniverse(config.universeSize);
  const matrix = await fetchAlignedCloses(universe);
  const blacklist = new Set(await getBlacklist());

  const pairs = discoverPairs(matrix, { maxCombos }).filter(
    (p) => !blacklist.has(pairKey(p.symbol_a, p.symbol_b)),
  );

  let saved = false;
  try {
    await savePairs(pairs);
    saved = true;
  } catch {
    saved = false;
  }

  return {
    universeSize: matrix.symbols.length,
    alignedBars: matrix.timestamps.length,
    pairsFound: pairs.length,
    topPairs: pairs.slice(0, 20),
    saved,
  };
}

export interface SignalRunSummary {
  evaluated: number;
  signals: Signal[];
  alertsSent: number;
}

/**
 * Evaluate signals for the currently stored pairs and persist/alert on any
 * actionable (entry/exit/stop) transitions.
 */
export async function runSignals(limitPairs = config.maxConcurrentPositions * 3): Promise<SignalRunSummary> {
  const pairs = (await getPairs(limitPairs)).filter((p) => p.cointegrated);
  const signals: Signal[] = [];
  let alertsSent = 0;

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
    signals.push(sig);
    if (isAlertable(sig.side)) {
      const ok = await alertSignal(sig);
      if (ok) alertsSent++;
    }
  }

  const actionable = signals.filter((s) => isAlertable(s.side));
  try {
    await saveSignals(actionable);
  } catch {
    // best-effort persistence
  }

  return { evaluated: pairs.length, signals, alertsSent };
}
