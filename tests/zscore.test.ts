import { describe, it, expect } from "vitest";
import { rollingZScore, rollingMean, rollingStd, latestZScore } from "@/lib/stats/zscore";

describe("Rolling z-score", () => {
  it("computes correct rolling mean", () => {
    const x = [1, 2, 3, 4, 5];
    const m = rollingMean(x, 3);
    expect(m[0]).toBeNaN();
    expect(m[1]).toBeNaN();
    expect(m[2]).toBeCloseTo(2, 9); // (1+2+3)/3
    expect(m[3]).toBeCloseTo(3, 9); // (2+3+4)/3
    expect(m[4]).toBeCloseTo(4, 9); // (3+4+5)/3
  });

  it("computes correct rolling sample std", () => {
    const x = [2, 4, 6, 8];
    const s = rollingStd(x, 2);
    // pairwise std with n-1 denom: sqrt(((a-m)^2+(b-m)^2)/1) = |b-a|/sqrt(2)
    expect(s[1]).toBeCloseTo(Math.SQRT2, 6); // |4-2|/sqrt(2) = sqrt(2)
  });

  it("produces NaN before the window fills, then finite values", () => {
    const x = Array.from({ length: 10 }, (_, i) => Math.sin(i));
    const z = rollingZScore(x, 5);
    for (let i = 0; i < 4; i++) expect(z[i]).toBeNaN();
    expect(Number.isFinite(z[9])).toBe(true);
  });

  it("standardizes: a value at the rolling mean has z = 0", () => {
    // Window where last value equals the mean of the window.
    const x = [10, 0, 10, 0, 5]; // window of 5: mean = 5, last value = 5 → z=0
    const z = rollingZScore(x, 5);
    expect(z[4]).toBeCloseTo(0, 9);
  });

  it("latestZScore returns the most recent finite value", () => {
    const x = Array.from({ length: 100 }, (_, i) => Math.cos(i / 3));
    const z = latestZScore(x, 20);
    expect(Number.isFinite(z)).toBe(true);
  });
});
