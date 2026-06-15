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
import type { Pair } from "@/lib/types";
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
  /**
   * True when BH yielded zero pairs and we fell back to the conventional α cut.
   * These pairs are statistically plausible but NOT FDR-confirmed (lower
   * confidence). Surface this to the user.
   */
  usedFallback: boolean;
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
  const { symbols, closes } = matrix;
  const n = symbols.length;
  const maxCombos = options.maxCombos ?? Infinity;

  // ── Phase 1: Gather ADF candidates ──────────────────────────────────────
  interface Candidate {
    i: number;
    j: number;
    corr: number;
    beta: number;
    intercept: number;
    pValue: number;
  }

  const candidates: Candidate[] = [];
  let combosEvaluated = 0;

  outer: for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (combosEvaluated >= maxCombos) break outer;
      combosEvaluated++;

      const a = closes[i];
      const b = closes[j];
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

      candidates.push({ i, j, corr, beta: res.beta, intercept: res.alpha, pValue: res.pValue });
    }
  }

  // ── Phase 2: Benjamini-Hochberg FDR correction ───────────────────────────
  const bhThreshold = benjaminiHochberg(
    candidates.map((c) => c.pValue),
    config.fdrAlpha,
  );

  // Count how many would have passed the naive threshold but are dropped by BH.
  const naivePass = candidates.filter((c) => c.pValue <= config.adfPValueMax).length;
  const bhPass = candidates.filter((c) => c.pValue <= bhThreshold).length;
  const droppedByBH = Math.max(0, naivePass - bhPass);

  // ── Phase 3: Apply threshold + half-life + Hurst, score and rank ─────────
  const qualify = (threshold: number): Pair[] => {
    const result: Pair[] = [];
    for (const c of candidates) {
      if (c.pValue > threshold) continue;

      const a = closes[c.i];
      const b = closes[c.j];
      const spread = staticSpread(a, b, c.beta, c.intercept);

      const hl = halfLife(spread);
      if (!Number.isFinite(hl) || hl < config.halfLifeMinBars || hl > config.halfLifeMaxBars) {
        continue;
      }

      const hurst = hurstExponent(spread);
      if (hurst >= config.hurstMax) continue;

      result.push({
        symbol_a: symbols[c.i],
        symbol_b: symbols[c.j],
        beta: c.beta,
        alpha: c.intercept,
        adf_pvalue: c.pValue,
        half_life: hl,
        hurst,
        correlation: c.corr,
        score: scorePair(c.pValue, hl, hurst),
        cointegrated: true,
        timeframe: config.timeframe,
      });
    }
    result.sort((x, y) => y.score - x.score);
    return result;
  };

  // Primary: BH-confirmed pairs (FDR-controlled, high confidence).
  let out = qualify(bhThreshold);
  let usedFallback = false;

  // Fallback: a small universe makes BH very strict (few tests → tiny
  // threshold), so genuinely-cointegrated pairs can all be swept away. If
  // nothing survives, fall back to the conventional α cut so the user still
  // sees plausible candidates — flagged as non-FDR-confirmed.
  if (out.length === 0) {
    const fb = qualify(config.adfPValueMax);
    if (fb.length > 0) {
      out = fb;
      usedFallback = true;
    }
  }

  return {
    pairs: out,
    candidatesBeforeBH: naivePass,
    droppedByBH,
    bhThreshold,
    combosEvaluated,
    usedFallback,
  };
}
