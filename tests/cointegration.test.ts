import { describe, it, expect } from "vitest";
import { engleGranger } from "@/lib/stats/cointegration";
import { cointegratedPair, randomWalk } from "./helpers";

describe("Engle-Granger cointegration", () => {
  it("DETECTS a synthetic cointegrated pair and recovers the hedge ratio", () => {
    const beta = 1.5;
    const alpha = 10;
    const { a, b } = cointegratedPair(500, beta, alpha, 4242, 1);
    const res = engleGranger(a, b);
    expect(res.cointegrated).toBe(true);
    expect(res.pValue).toBeLessThan(0.05);
    // The hedge ratio (beta) is what matters for trading and is recovered
    // tightly. The intercept is extrapolated far from the data range (prices
    // ~100+) so it is inherently noisy; the z-score absorbs the spread mean,
    // so we only sanity-check alpha's order of magnitude.
    expect(res.beta).toBeCloseTo(beta, 1);
    expect(Math.abs(res.alpha - alpha)).toBeLessThan(5);
  });

  it("REJECTS two independent random walks", () => {
    const a = randomWalk(500, 111, 0.03).map((v) => v + 100);
    const b = randomWalk(500, 222, 0.04).map((v) => v + 100);
    const res = engleGranger(a, b);
    expect(res.cointegrated).toBe(false);
    expect(res.pValue).toBeGreaterThan(0.05);
  });

  it("detects cointegration across several seeds", () => {
    let detected = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { a, b } = cointegratedPair(500, 0.8, 5, seed * 53, 1);
      if (engleGranger(a, b).cointegrated) detected++;
    }
    expect(detected).toBeGreaterThanOrEqual(7);
  });

  it("does not spuriously cointegrate independent random walks", () => {
    let detected = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const a = randomWalk(500, seed * 13, 0.02).map((v) => v + 100);
      const b = randomWalk(500, seed * 29 + 5, 0.02).map((v) => v + 100);
      if (engleGranger(a, b).cointegrated) detected++;
    }
    expect(detected).toBeLessThanOrEqual(2);
  });
});
