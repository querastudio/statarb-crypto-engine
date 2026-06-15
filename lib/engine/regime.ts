// Regime detection: classifies current market conditions as SAFE / CAUTION / DANGER
// for a spread series using three independent signals.
//
// Why this matters: cointegration is a long-run property. In the short run,
// pairs can "break" temporarily — during market stress, macro events, or
// structural changes. Trading during a regime break is the #1 cause of
// outsized losses in stat-arb. These signals catch early warning signs.
//
// Three signals (each either triggers or not):
//   1. Volatility expansion  — fast spread vol >> slow spread vol → regime change
//   2. Z-score persistence   — |z| has been consistently high → spread is trending, not reverting
//   3. Spread drift          — spread mean has shifted vs historical → structural break

export type RegimeLabel = "SAFE" | "CAUTION" | "DANGER";

export interface RegimeState {
  /** 0..1: fraction of regime signals that are OK (1 = all clear, 0 = all triggered). */
  score: number;
  label: RegimeLabel;
  color: string;
  /** Plain-language explanations for each triggered warning. */
  warnings: string[];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/**
 * Detect the current regime from the spread and z-score series.
 * Uses only data up to and including the current bar (no look-ahead).
 *
 * `lookback` is the slow window (default 40 bars). Fast window = lookback/4.
 */
export function detectRegime(
  spread: number[],
  zscore: number[],
  lookback = 40,
): RegimeState {
  const warnings: string[] = [];
  const n = spread.length;
  const minRequired = lookback * 2;

  if (n < minRequired) {
    return {
      score: 0.5,
      label: "CAUTION",
      color: "var(--amber)",
      warnings: ["Data terlalu sedikit untuk mendeteksi regime — perlu lebih banyak bar riwayat"],
    };
  }

  // ── Signal 1: Volatility expansion ─────────────────────────────────────
  // Fast vol should not be much higher than slow vol in a stable regime.
  const fastLen = Math.max(5, Math.floor(lookback / 4));
  const spreadFast = spread.slice(-fastLen).filter(Number.isFinite);
  const spreadSlow = spread.slice(-lookback).filter(Number.isFinite);
  const volFast = std(spreadFast);
  const volSlow = std(spreadSlow);
  const volRatio = volSlow > 1e-10 ? volFast / volSlow : 1;
  if (volRatio > 1.8) {
    warnings.push(
      `Volatilitas spread melonjak ${volRatio.toFixed(1)}× lebih tinggi dari normal (maks aman: 1.8×)`,
    );
  }

  // ── Signal 2: Z-score persistence ──────────────────────────────────────
  // In a healthy regime, |z| should oscillate around 0, not stay high.
  const zWindow = Math.floor(lookback / 2);
  const recentZ = zscore.slice(-zWindow).filter(Number.isFinite);
  const meanAbsZ = recentZ.length > 0
    ? recentZ.reduce((s, z) => s + Math.abs(z), 0) / recentZ.length
    : 0;
  if (meanAbsZ > 1.5) {
    warnings.push(
      `Z-score rata-rata ${meanAbsZ.toFixed(2)} dalam ${zWindow} bar terakhir — spread mungkin sedang trending, bukan mean-reverting`,
    );
  }

  // ── Signal 3: Spread drift (structural break heuristic) ────────────────
  // If the recent spread mean has moved far from historical, the relationship
  // may have structurally changed.
  const histWindow = Math.floor(lookback * 1.5);
  const spreadRecent = spread.slice(-lookback).filter(Number.isFinite);
  const spreadHist = spread.slice(-(lookback + histWindow), -lookback).filter(Number.isFinite);
  if (spreadHist.length >= 10) {
    const muRecent = mean(spreadRecent);
    const muHist = mean(spreadHist);
    const sdHist = std(spreadHist);
    const drift = sdHist > 1e-10 ? Math.abs(muRecent - muHist) / sdHist : 0;
    if (drift > 1.5) {
      warnings.push(
        `Spread telah bergeser ${drift.toFixed(1)}σ dari rata-rata historis — kemungkinan ada perubahan struktural`,
      );
    }
  }

  const nSignals = 3;
  const nWarnings = warnings.length;
  const score = Math.max(0, 1 - nWarnings / nSignals);

  const label: RegimeLabel =
    nWarnings === 0 ? "SAFE" : nWarnings === 1 ? "CAUTION" : "DANGER";

  const color =
    label === "SAFE" ? "var(--green)" :
    label === "CAUTION" ? "var(--amber)" :
    "var(--red)";

  return { score, label, color, warnings };
}
