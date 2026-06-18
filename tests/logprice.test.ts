import { describe, it, expect } from "vitest";
import { backtestPair } from "@/lib/engine/backtest";
import { sizeLogSpreadPosition } from "@/lib/risk/sizing";
import { engleGranger } from "@/lib/stats/cointegration";
import { mulberry32, gaussian, randomWalk } from "./helpers";

/**
 * Build a LOG-cointegrated pair: logB is a random walk, logA = α + β·logB +
 * stationary noise, prices = exp(logs). The log spread logA − β·logB is
 * stationary by construction — this is the regime the production engine assumes.
 */
function logCointegratedPair(
  n: number,
  beta: number,
  alpha: number,
  seed: number,
  noiseSigma = 0.02,
): { a: number[]; b: number[] } {
  const logB = randomWalk(n, seed, 0.001, 0.02).map((v) => v + Math.log(100));
  const noise = mulberry32(seed + 7919);
  const logA = logB.map((lb) => alpha + beta * lb + noiseSigma * gaussian(noise));
  return { a: logA.map(Math.exp), b: logB.map(Math.exp) };
}

describe("Log-price sizing", () => {
  it("risks ~capitalAtRisk when the log spread reaches the stop", () => {
    const equity = 10_000;
    const risk = 0.01; // 1% → capitalAtRisk = 100
    const beta = 1.5;
    const d = 0.08; // log-spread distance to stop
    const r = sizeLogSpreadPosition({
      equity,
      priceA: 64000,
      priceB: 3000,
      beta,
      logSpreadStopDistance: d,
      riskPerTrade: risk,
    });

    expect(r.capitalAtRisk).toBeCloseTo(100, 6);
    // Loss at stop = (notional on A) · d = capitalAtRisk.
    const notionalA = r.unitsA * 64000;
    expect(notionalA * d).toBeCloseTo(100, 4);
    // Leg B notional is |beta|× leg A notional (dollar-weighted hedge).
    const notionalB = r.unitsB * 3000;
    expect(notionalB).toBeCloseTo(notionalA * beta, 4);
    expect(r.grossNotional).toBeCloseTo(notionalA + notionalB, 4);
  });

  it("zero distance yields zero size (no divide-by-zero)", () => {
    const r = sizeLogSpreadPosition({
      equity: 1000,
      priceA: 100,
      priceB: 100,
      beta: 1,
      logSpreadStopDistance: 0,
    });
    expect(r.unitsA).toBe(0);
    expect(r.unitsB).toBe(0);
  });
});

describe("Log-price cointegration & backtest", () => {
  it("detects a log-cointegrated pair on log prices", () => {
    const { a, b } = logCointegratedPair(500, 1.2, 0.5, 4242, 0.02);
    const res = engleGranger(a.map(Math.log), b.map(Math.log));
    expect(res.cointegrated).toBe(true);
    expect(res.pValue).toBeLessThan(0.05);
    expect(res.beta).toBeCloseTo(1.2, 1);
  });

  it("backtests a log-cointegrated pair with sane metrics (log mode)", () => {
    const { a, b } = logCointegratedPair(800, 1.0, 0.3, 2026, 0.025);
    const res = backtestPair("A/USDT", "B/USDT", a, b, undefined, { useLogPrices: true });

    expect(res.params.useLogPrices).toBe(true);
    expect(res.equityCurve.length).toBe(a.length);
    expect(res.metrics.totalTrades).toBeGreaterThan(0);
    expect(Number.isFinite(res.metrics.sharpe)).toBe(true);
    expect(res.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(res.metrics.maxDrawdown).toBeLessThanOrEqual(1);
    // Costs only subtract: net ≤ gross.
    expect(res.metrics.totalReturn).toBeLessThanOrEqual(res.metricsGross.totalReturn + 1e-9);
  });
});
