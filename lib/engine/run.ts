// High-level orchestration used by the cron endpoints. Kept separate from the
// route handlers so the logic is testable and the routes stay thin.

import { config } from "@/lib/config";
import { fetchAlignedCloses, getLiquidUniverse } from "@/lib/data/exchange";
import {
  discoverPairs,
  collectCandidates,
  finalizeFromCandidates,
  closeLookup,
  comboRangeForChunk,
  totalCombos,
} from "./discovery";
// discoverPairs now returns DiscoveryResult (pairs + BH correction stats)
import { generateSignal } from "./signals";
import {
  getPairs,
  savePairs,
  saveSignals,
  getBlacklist,
  pairKey,
  setScanSession,
  getScanSession,
  clearScanCandidates,
  appendScanCandidates,
  getScanCandidates,
} from "@/lib/db/supabase";
import { alertSignal, isAlertable } from "@/lib/alert/telegram";
import type { Pair, Signal } from "@/lib/types";

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
  };
}

export interface ChunkScanSummary {
  mode: "chunk";
  chunk: number;
  chunks: number;
  universeSize: number;
  combosTotal: number;
  combosInChunk: number;
  candidatesInChunk: number;
  finalized: boolean;
  // Present only on the finalizing (last) chunk:
  pairsFound?: number;
  saved?: boolean;
  saveError?: string;
  candidatesBeforeBH?: number;
  droppedByBH?: number;
  bhThreshold?: number;
}

/**
 * Run one chunk of a chunked discovery scan.
 *
 * Chunk 0 pins the universe ordering and clears prior candidates. Every chunk
 * fetches the (pinned) universe's aligned closes, evaluates its slice of the
 * combination space, and appends candidates. The final chunk then runs
 * Benjamini-Hochberg over the COMPLETE candidate set and saves ranked pairs.
 *
 * This keeps each invocation well under Vercel's 60s limit while preserving
 * the statistical correctness of the FDR correction (which must see all
 * p-values at once).
 */
export async function runScanChunk(chunk: number, chunks: number): Promise<ChunkScanSummary> {
  if (!Number.isInteger(chunks) || chunks < 1) throw new Error("`chunks` must be >= 1");
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= chunks) {
    throw new Error(`\`chunk\` must be in [0, ${chunks - 1}]`);
  }

  // Determine the pinned symbol ordering for this scan session.
  let symbols: string[];
  if (chunk === 0) {
    symbols = await getLiquidUniverse(config.universeSize);
    await setScanSession(symbols);
    await clearScanCandidates();
  } else {
    symbols = await getScanSession();
    if (symbols.length === 0) {
      throw new Error("No active scan session — run chunk 0 first");
    }
  }

  // Fetch aligned closes for the pinned universe. Combo enumeration is based on
  // the pinned `symbols` list (not the fetched set) so indices stay identical
  // across chunks even if a symbol transiently fails to fetch.
  const matrix = await fetchAlignedCloses(symbols, config.timeframe, SCAN_LOOKBACK);
  const closeOf = closeLookup(matrix);

  const range = comboRangeForChunk(symbols.length, chunk, chunks);
  const { candidates, combosEvaluated } = collectCandidates(symbols, closeOf, range);
  await appendScanCandidates(candidates);

  const isLast = chunk === chunks - 1;
  const summary: ChunkScanSummary = {
    mode: "chunk",
    chunk,
    chunks,
    universeSize: symbols.length,
    combosTotal: totalCombos(symbols.length),
    combosInChunk: combosEvaluated,
    candidatesInChunk: candidates.length,
    finalized: false,
  };

  if (!isLast) return summary;

  // ── Final chunk: BH over ALL candidates, then save ranked pairs ───────────
  const allCandidates = await getScanCandidates();
  const result = finalizeFromCandidates(allCandidates, closeOf);

  const blacklist = new Set(await getBlacklist());
  const pairs = result.pairs.filter((p) => !blacklist.has(pairKey(p.symbol_a, p.symbol_b)));

  let saved = false;
  let saveError: string | undefined;
  try {
    await savePairs(pairs);
    saved = true;
  } catch (e) {
    saveError = (e as Error).message;
  }

  // Clean up accumulated candidates so the next scan starts fresh.
  try {
    await clearScanCandidates();
  } catch {
    /* best-effort */
  }

  return {
    ...summary,
    finalized: true,
    pairsFound: pairs.length,
    saved,
    saveError,
    candidatesBeforeBH: result.candidatesBeforeBH,
    droppedByBH: result.droppedByBH,
    bhThreshold: result.bhThreshold,
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
