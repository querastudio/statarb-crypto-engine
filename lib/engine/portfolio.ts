// Portfolio-level risk analysis.
//
// Individual pair analysis (regime, z-score) misses cross-pair risks:
//   - Too many positions open at once → overexposure
//   - All positions in same direction → not market-neutral (directional bet)
//   - Same symbol appearing in multiple pairs → concentrated single-asset risk
//
// This module evaluates the whole portfolio at once.

import type { Signal, Pair } from "@/lib/types";

export type PortfolioVerdict = "SAFE" | "CAUTION" | "DANGER";

export interface PortfolioRisk {
  totalOpen: number;
  longCount: number;
  shortCount: number;
  maxPositions: number;
  utilizationPct: number;
  isNeutral: boolean;
  /** Symbols that appear in 2+ active pairs simultaneously. */
  doubleExposure: string[];
  verdict: PortfolioVerdict;
  warnings: string[];
}

/**
 * Analyse portfolio-level risk from the current set of active open signals.
 *
 * Pass only LONG_SPREAD / SHORT_SPREAD signals (already-open positions).
 * `pairs` is used to cross-check correlation between concurrently open pairs.
 */
export function analyzePortfolio(
  openSignals: Signal[],
  pairs: Pair[],
  maxPositions = 10,
): PortfolioRisk {
  const longCount = openSignals.filter((s) => s.side === "LONG_SPREAD").length;
  const shortCount = openSignals.filter((s) => s.side === "SHORT_SPREAD").length;
  const totalOpen = openSignals.length;
  const utilizationPct = maxPositions > 0 ? totalOpen / maxPositions : 0;

  const warnings: string[] = [];

  // ── Check 1: Position capacity ────────────────────────────────────────────
  if (utilizationPct >= 1.0) {
    warnings.push(
      `Posisi PENUH: ${totalOpen}/${maxPositions} — jangan tambah posisi baru sampai ada yang ditutup`,
    );
  } else if (utilizationPct >= 0.8) {
    warnings.push(`Hampir penuh: ${totalOpen}/${maxPositions} posisi aktif (≥80% kapasitas)`);
  }

  // ── Check 2: Market neutrality ────────────────────────────────────────────
  // Stat-arb is supposed to be market-neutral (equal long & short exposure).
  // If heavily skewed, you're taking a directional bet on the market.
  const bias = totalOpen >= 2 ? Math.abs(longCount - shortCount) / totalOpen : 0;
  const isNeutral = bias <= 0.4;
  if (!isNeutral && totalOpen >= 2) {
    const dir = longCount > shortCount ? "LONG" : "SHORT";
    warnings.push(
      `Portfolio tidak netral: ${longCount} LONG vs ${shortCount} SHORT — bias ${dir} berarti kamu sedang bertaruh arah pasar, bukan spread`,
    );
  }

  // ── Check 3: Symbol double-exposure ──────────────────────────────────────
  // If BTC appears in ETH/BTC and XRP/BTC simultaneously, losing BTC position
  // hits you twice — the exposures compound.
  const symbolCount = new Map<string, number>();
  for (const s of openSignals) {
    symbolCount.set(s.symbol_a, (symbolCount.get(s.symbol_a) ?? 0) + 1);
    symbolCount.set(s.symbol_b, (symbolCount.get(s.symbol_b) ?? 0) + 1);
  }
  const doubleExposure: string[] = [];
  for (const [sym, count] of symbolCount) {
    if (count >= 2) doubleExposure.push(sym);
  }
  if (doubleExposure.length > 0) {
    warnings.push(
      `Simbol ${doubleExposure.join(", ")} muncul di beberapa pair aktif — risiko eksposur ganda`,
    );
  }

  // ── Check 4: High inter-pair correlation ──────────────────────────────────
  // Two pairs that are 90%+ correlated behave almost identically.
  // Running both is effectively doubling a single position.
  const pairCorr = new Map(pairs.map((p) => [`${p.symbol_a}|${p.symbol_b}`, p.correlation]));
  const lookup = (a: string, b: string) =>
    pairCorr.get(`${a}|${b}`) ?? pairCorr.get(`${b}|${a}`) ?? 0;

  const highCorrFound: string[] = [];
  for (let i = 0; i < openSignals.length && highCorrFound.length < 2; i++) {
    for (let j = i + 1; j < openSignals.length; j++) {
      // Check correlation between the A-legs of the two pairs.
      const corrAA = Math.abs(lookup(openSignals[i].symbol_a, openSignals[j].symbol_a));
      if (corrAA >= 0.9) {
        highCorrFound.push(
          `${openSignals[i].symbol_a}/${openSignals[i].symbol_b} ↔ ${openSignals[j].symbol_a}/${openSignals[j].symbol_b}`,
        );
        break;
      }
    }
  }
  if (highCorrFound.length > 0) {
    warnings.push(
      `Pair sangat berkorelasi aktif bersamaan (${highCorrFound[0]}) — pertimbangkan tutup salah satu`,
    );
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const severeWarnings = warnings.filter(
    (w) => w.includes("PENUH") || w.includes("tidak netral") || w.includes("ganda"),
  ).length;
  const verdict: PortfolioVerdict =
    severeWarnings >= 2 ? "DANGER" : warnings.length > 0 ? "CAUTION" : "SAFE";

  return {
    totalOpen,
    longCount,
    shortCount,
    maxPositions,
    utilizationPct,
    isNeutral,
    doubleExposure,
    verdict,
    warnings,
  };
}
