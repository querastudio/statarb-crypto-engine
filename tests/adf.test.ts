import { describe, it, expect } from "vitest";
import { adfTest } from "@/lib/stats/adf";
import { randomWalk, ar1 } from "./helpers";

describe("ADF test", () => {
  it("REJECTS the unit root for a stationary AR(1) series", () => {
    // phi = 0.2 is strongly mean-reverting → should be flagged stationary.
    const series = ar1(400, 0.2, 12345);
    const res = adfTest(series);
    expect(res.statistic).toBeLessThan(res.criticalValues["5%"]);
    expect(res.stationary).toBe(true);
    expect(res.pValue).toBeLessThan(0.05);
  });

  it("FAILS to reject the unit root for a random walk", () => {
    const series = randomWalk(400, 999);
    const res = adfTest(series);
    // A random walk should not be flagged stationary.
    expect(res.statistic).toBeGreaterThan(res.criticalValues["5%"]);
    expect(res.stationary).toBe(false);
    expect(res.pValue).toBeGreaterThan(0.05);
  });

  it("is consistent across several stationary seeds", () => {
    let rejections = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const series = ar1(400, 0.3, seed * 17);
      if (adfTest(series).stationary) rejections++;
    }
    // Strongly stationary series should be detected almost every time.
    expect(rejections).toBeGreaterThanOrEqual(9);
  });

  it("rarely false-positives on random walks", () => {
    let rejections = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const series = randomWalk(400, seed * 31 + 3);
      if (adfTest(series).stationary) rejections++;
    }
    // Size of the test ~5%; allow a small margin over 10 trials.
    expect(rejections).toBeLessThanOrEqual(2);
  });
});
