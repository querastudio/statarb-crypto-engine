// Pair discovery: scan a universe of aligned price series and rank pairs that
// pass the full statistical gauntlet (correlation pre-filter → Engle-Granger
// cointegration → half-life window → Hurst < 0.5).

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
 * Composite ranking score for a candidate pair. Higher is better.
 * Rewards low ADF p-value, an ideal half-life (mid-window), and strong
 * anti-persistence (low Hurst).
 */
export function scorePair(adfPValue: number, hl: number, hurst: number): number {
  const pComponent = 1 - Math.min(1, adfPValue / config.adfPValueMax); // 1 best, 0 at threshold
  // Ideal half-life is the geometric centre of the allowed window.
  const ideal = Math.sqrt(config.halfLifeMinBars * config.halfLifeMaxBars);
  const hlComponent = 1 / (1 + Math.abs(Math.log(hl / ideal)));
  const hurstComponent = Math.max(0, (0.5 - hurst) / 0.5); // 1 at hurst 0, 0 at 0.5
  return 0.5 * pComponent + 0.3 * hlComponent + 0.2 * hurstComponent;
}

export interface DiscoveryOptions {
  /** Cap the number of (i,j) combinations evaluated (serverless time budget). */
  maxCombos?: number;
}

/**
 * Run discovery over a price matrix and return ranked, qualifying pairs.
 */
export function discoverPairs(matrix: PriceMatrix, options: DiscoveryOptions = {}): Pair[] {
  const { symbols, closes } = matrix;
  const n = symbols.length;
  const out: Pair[] = [];
  let combos = 0;
  const maxCombos = options.maxCombos ?? Infinity;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (combos >= maxCombos) break;
      combos++;

      const a = closes[i];
      const b = closes[j];
      if (!a || !b || a.length < 60) continue;

      // 1) Correlation pre-filter (cheap).
      const corr = correlation(a, b);
      if (Math.abs(corr) < config.minAbsCorrelation) continue;

      // 2) Engle-Granger cointegration. Orient A on the higher-priced leg as
      //    the dependent variable for numerical stability; the result is
      //    symmetric enough for screening.
      let res;
      try {
        res = engleGranger(a, b);
      } catch {
        continue;
      }
      if (!res.cointegrated) continue;

      // 3) Half-life of the static spread within the tradable window.
      const spread = staticSpread(a, b, res.beta, res.alpha);
      const hl = halfLife(spread);
      if (!Number.isFinite(hl) || hl < config.halfLifeMinBars || hl > config.halfLifeMaxBars) {
        continue;
      }

      // 4) Hurst confirmation of mean reversion.
      const hurst = hurstExponent(spread);
      if (hurst >= config.hurstMax) continue;

      out.push({
        symbol_a: symbols[i],
        symbol_b: symbols[j],
        beta: res.beta,
        alpha: res.alpha,
        adf_pvalue: res.pValue,
        half_life: hl,
        hurst,
        correlation: corr,
        score: scorePair(res.pValue, hl, hurst),
        cointegrated: true,
        timeframe: config.timeframe,
      });
    }
    if (combos >= maxCombos) break;
  }

  out.sort((x, y) => y.score - x.score);
  return out;
}
