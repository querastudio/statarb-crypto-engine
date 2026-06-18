// Signal generation for a single pair.
//
// Uses a Kalman-adaptive hedge ratio to form the dynamic spread, then a rolling
// z-score to produce entry / exit / stop signals per the strategy rules:
//
//   z > +entry  → SHORT_SPREAD  (short A, long beta·B)
//   z < -entry  → LONG_SPREAD   (long A,  short beta·B)
//   |z| < exit  → CLOSE
//   |z| > stop  → STOP          (likely structural break)

import { config } from "@/lib/config";
import { kalmanHedgeRatio } from "@/lib/stats/kalman";
import { staticSpread } from "@/lib/stats/cointegration";
import { rollingZScore } from "@/lib/stats/zscore";
import type { Signal, SignalSide } from "@/lib/types";

export interface SignalThresholds {
  zscoreWindow: number;
  entryThreshold: number;
  exitThreshold: number;
  stopThreshold: number;
}

const defaultThresholds: SignalThresholds = {
  zscoreWindow: config.zscoreWindow,
  entryThreshold: config.entryThreshold,
  exitThreshold: config.exitThreshold,
  stopThreshold: config.stopThreshold,
};

/** Classify a z-score into a stateless target side. */
export function classify(z: number, t: SignalThresholds): SignalSide {
  const az = Math.abs(z);
  if (az > t.stopThreshold) return "STOP";
  if (z > t.entryThreshold) return "SHORT_SPREAD";
  if (z < -t.entryThreshold) return "LONG_SPREAD";
  if (az < t.exitThreshold) return "CLOSE";
  return "FLAT";
}

export interface SpreadSeriesResult {
  beta: number[];
  spread: number[];
  zscore: number[];
}

/**
 * Build the spread and z-score series for a pair. When `useKalman` is true the
 * hedge ratio adapts every bar; otherwise a static `beta`/`alpha` is used.
 *
 * `useLogPrices` (default true): analyse in log-price space. Crypto prices move
 * multiplicatively, so cointegration and a constant hedge ratio are far more
 * natural on logs — the spread becomes (return-space) and is scale-invariant.
 * The resulting `beta` is the log-log hedge ratio and `spread` is the log
 * spread. Pass false to analyse raw price levels (e.g. for linearly-constructed
 * synthetic data).
 */
export function buildSpreadSeries(
  priceA: number[],
  priceB: number[],
  opts: {
    useKalman?: boolean;
    beta?: number;
    alpha?: number;
    window?: number;
    useLogPrices?: boolean;
  } = {},
): SpreadSeriesResult {
  const window = opts.window ?? defaultThresholds.zscoreWindow;

  const useLog = opts.useLogPrices ?? true;
  const a = useLog ? priceA.map((v) => Math.log(v)) : priceA;
  const b = useLog ? priceB.map((v) => Math.log(v)) : priceB;

  let spread: number[];
  let betaSeries: number[];

  if (opts.useKalman ?? true) {
    const kf = kalmanHedgeRatio(a, b);
    spread = kf.spread;
    betaSeries = kf.beta;
  } else {
    const beta = opts.beta ?? 1;
    const alpha = opts.alpha ?? 0;
    spread = staticSpread(a, b, beta, alpha);
    betaSeries = new Array(a.length).fill(beta);
  }

  const zscore = rollingZScore(spread, window);
  return { beta: betaSeries, spread, zscore };
}

/**
 * Generate the latest signal for a pair from aligned close prices.
 * Returns null if there is insufficient data to compute a z-score.
 */
export function generateSignal(
  symbolA: string,
  symbolB: string,
  priceA: number[],
  priceB: number[],
  thresholds: SignalThresholds = defaultThresholds,
): Signal | null {
  if (priceA.length < thresholds.zscoreWindow + 2) return null;

  const { beta, spread, zscore } = buildSpreadSeries(priceA, priceB, {
    useKalman: true,
    window: thresholds.zscoreWindow,
  });

  const lastIdx = zscore.length - 1;
  const z = zscore[lastIdx];
  if (!Number.isFinite(z)) return null;

  const side = classify(z, thresholds);
  const note = side === "STOP" ? "z beyond stop threshold — possible structural break" : undefined;

  return {
    symbol_a: symbolA,
    symbol_b: symbolB,
    side,
    zscore: z,
    beta: beta[lastIdx],
    spread: spread[lastIdx],
    price_a: priceA[priceA.length - 1],
    price_b: priceB[priceB.length - 1],
    note,
    timeframe: config.timeframe,
  };
}
