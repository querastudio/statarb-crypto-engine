// Pair discovery: scan a universe of aligned price series and rank pairs that
// pass the full statistical gauntlet:
//   correlation pre-filter → Engle-Granger ADF (all p-values collected) →
//   Benjamini-Hochberg FDR correction → half-life window → Hurst < 0.5
//
// The BH step is critical: without it, testing 1000+ combinations at α=0.05
// produces ~50 false positives by pure chance. BH controls the expected
// fraction of false discoveries to at most fdrAlpha (default 10%).

import { config } from "@/lib/config";
import { engleGranger, staticSpread } from "@/lib/stats/cointegration";
import { halfLife } from "@/lib/stats/halflife";
import { hurstExponent } from "@/lib/stats/hurst";
import type { Pair, ScanCandidate } from "@/lib/types";
import type { PriceMatrix } from "@/lib/data/exchange";

/** Pearson correlation of two equal-length series. */
export function correlation(a: number[], b: number[]): number {
  const n = a.length;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/**
 * Benjamini-Hochberg procedure for False Discovery Rate control.
 *
 * Given m hypothesis tests, sort their p-values p(1) ≤ p(2) ≤ … ≤ p(m).
 * Find the largest k where p(k) ≤ (k/m) × alpha. Reject all p ≤ p(k).
 *
 * At most `alpha` fraction of the reported discoveries are expected to be
 * false positives (FDR ≤ alpha), with much higher power than Bonferroni.
 *
 * Returns the p-value threshold (0 if no tests pass).
 */
export function benjaminiHochberg(pValues: number[], alpha: number): number {
  if (pValues.length === 0) return 0;
  const m = pValues.length;
  const sorted = [...pValues].sort((a, b) => a - b);
  let threshold = 0;
  for (let k = m; k >= 1; k--) {
    if (sorted[k - 1] <= (k / m) * alpha) {
      threshold = sorted[k - 1];
      break;
    }
  }
  return threshold;
}

/**
 * Composite ranking score for a candidate pair. Higher is better.
 * Rewards low ADF p-value, an ideal half-life (mid-window), and strong
 * anti-persistence (low Hurst).
 */
export function scorePair(adfPValue: number, hl: number, hurst: number): number {
  const pComponent = 1 - Math.min(1, adfPValue / config.adfPValueMax);
  const ideal = Math.sqrt(config.halfLifeMinBars * config.halfLifeMaxBars);
  const hlComponent = 1 / (1 + Math.abs(Math.log(hl / ideal)));
  const hurstComponent = Math.max(0, (0.5 - hurst) / 0.5);
  return 0.5 * pComponent + 0.3 * hlComponent + 0.2 * hurstComponent;
}

export interface DiscoveryOptions {
  /** Cap the number of (i,j) combinations evaluated (serverless time budget). */
  maxCombos?: number;
}

export interface DiscoveryResult {
  pairs: Pair[];
  /** Pairs that passed correlation + ADF before BH correction. */
  candidatesBeforeBH: number;
  /** Pairs dropped purely by BH correction (would have passed naive α filter). */
  droppedByBH: number;
  /** The BH-adjusted p-value threshold actually used. */
  bhThreshold: number;
  /** Total (i,j) combinations evaluated. */
  combosEvaluated: number;
}

/** A contiguous slice of the (i,j) combination enumeration. */
export interface ComboRange {
  /** Inclusive start combo index. */
  start: number;
  /** Exclusive end combo index. */
  end: number;
}

/** Total number of unordered (i,j) combinations for n symbols. */
export function totalCombos(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

/** Combo index range [start, end) belonging to chunk `k` of `chunks`. */
export function comboRangeForChunk(n: number, chunk: number, chunks: number): ComboRange {
  const total = totalCombos(n);
  const start = Math.floor((chunk * total) / chunks);
  const end = Math.floor(((chunk + 1) * total) / chunks);
  return { start, end };
}

/**
 * Phase 1 — collect raw candidates (correlation + Engle-Granger ADF) over the
 * combinations of `symbols`, looking up each series via `closeOf`. Enumeration
 * order is fixed (i<j) so combo indices are stable across chunk runs as long as
 * the `symbols` ordering is identical.
 *
 * Pass `range` to only evaluate a contiguous slice of combos (chunked scan).
 */
export function collectCandidates(
  symbols: string[],
  closeOf: (symbol: string) => number[] | undefined,
  range?: ComboRange,
): { candidates: ScanCandidate[]; combosEvaluated: number } {
  const n = symbols.length;
  const candidates: ScanCandidate[] = [];
  let comboIndex = -1;
  let combosEvaluated = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      comboIndex++;
      if (range && (comboIndex < range.start || comboIndex >= range.end)) continue;
      combosEvaluated++;

      const a = closeOf(symbols[i]);
      const b = closeOf(symbols[j]);
      if (!a || !b || a.length < 60) continue;

      // Correlation pre-filter (cheap — eliminates ~80% of pairs immediately).
      const corr = correlation(a, b);
      if (Math.abs(corr) < config.minAbsCorrelation) continue;

      // Run Engle-Granger ADF — collect p-value regardless of threshold.
      // We do NOT apply `res.cointegrated` here; BH decides the cutoff.
      let res;
      try {
        res = engleGranger(a, b);
      } catch {
        continue;
      }

      candidates.push({
        symbol_a: symbols[i],
        symbol_b: symbols[j],
        corr,
        beta: res.beta,
        alpha: res.alpha,
        pValue: res.pValue,
      });
    }
  }

  return { candidates, combosEvaluated };
}

/**
 * Phase 2 + 3 — Benjamini-Hochberg FDR correction across ALL candidates at
 * once, then apply the corrected threshold + half-life + Hurst filters and
 * rank. `closeOf` provides the aligned series for half-life/Hurst computation.
 */
export function finalizeFromCandidates(
  candidates: ScanCandidate[],
  closeOf: (symbol: string) => number[] | undefined,
): DiscoveryResult {
  // ── Phase 2: Benjamini-Hochberg FDR correction ───────────────────────────
  const bhThreshold = benjaminiHochberg(
    candidates.map((c) => c.pValue),
    config.fdrAlpha,
  );

  // Count how many would have passed the naive threshold but are dropped by BH.
  const naivePass = candidates.filter((c) => c.pValue <= config.adfPValueMax).length;
  const bhPass = candidates.filter((c) => c.pValue <= bhThreshold).length;
  const droppedByBH = Math.max(0, naivePass - bhPass);

  // ── Phase 3: Apply BH threshold + half-life + Hurst ─────────────────────
  const out: Pair[] = [];

  for (const c of candidates) {
    if (c.pValue > bhThreshold) continue;

    const a = closeOf(c.symbol_a);
    const b = closeOf(c.symbol_b);
    if (!a || !b) continue;

    const spread = staticSpread(a, b, c.beta, c.alpha);

    const hl = halfLife(spread);
    if (!Number.isFinite(hl) || hl < config.halfLifeMinBars || hl > config.halfLifeMaxBars) {
      continue;
    }

    const hurst = hurstExponent(spread);
    if (hurst >= config.hurstMax) continue;

    out.push({
      symbol_a: c.symbol_a,
      symbol_b: c.symbol_b,
      beta: c.beta,
      alpha: c.alpha,
      adf_pvalue: c.pValue,
      half_life: hl,
      hurst,
      correlation: c.corr,
      score: scorePair(c.pValue, hl, hurst),
      cointegrated: true,
      timeframe: config.timeframe,
    });
  }

  out.sort((x, y) => y.score - x.score);

  return {
    pairs: out,
    candidatesBeforeBH: naivePass,
    droppedByBH,
    bhThreshold,
    combosEvaluated: candidates.length,
  };
}

/** Build a symbol→closes lookup from a price matrix. */
export function closeLookup(matrix: PriceMatrix): (symbol: string) => number[] | undefined {
  const idx = new Map(matrix.symbols.map((s, i) => [s, i] as const));
  return (symbol: string) => {
    const i = idx.get(symbol);
    return i === undefined ? undefined : matrix.closes[i];
  };
}

/**
 * Run discovery over a price matrix and return ranked, qualifying pairs.
 *
 * Two-phase approach:
 *   Phase 1 — collect all ADF p-values for correlated pairs (no early cutoff).
 *   Phase 2 — Benjamini-Hochberg FDR correction across ALL p-values at once,
 *             then apply the corrected threshold + half-life + Hurst filters.
 */
export function discoverPairs(
  matrix: PriceMatrix,
  options: DiscoveryOptions = {},
): DiscoveryResult {
  const closeOf = closeLookup(matrix);
  const range =
    options.maxCombos !== undefined ? { start: 0, end: options.maxCombos } : undefined;
  const { candidates, combosEvaluated } = collectCandidates(matrix.symbols, closeOf, range);
  const result = finalizeFromCandidates(candidates, closeOf);
  return { ...result, combosEvaluated };
}
