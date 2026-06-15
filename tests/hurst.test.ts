import { describe, it, expect } from "vitest";
import { hurstExponent } from "@/lib/stats/hurst";
import { ar1, randomWalk } from "./helpers";

/** Persistent series: cumulative sum of positively-autocorrelated increments. */
function persistentSeries(n: number, phi: number, seed: number): number[] {
  const increments = ar1(n, phi, seed); // positive phi → persistent increments
  const out = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += increments[i];
    out[i] = acc;
  }
  return out;
}

describe("Hurst exponent", () => {
  it("is below 0.5 for a mean-reverting series", () => {
    const series = ar1(2000, 0.2, 808);
    const h = hurstExponent(series);
    expect(h).toBeLessThan(0.5);
  });

  it("is near 0.5 for a random walk", () => {
    const series = randomWalk(3000, 555);
    const h = hurstExponent(series);
    expect(h).toBeGreaterThan(0.4);
    expect(h).toBeLessThan(0.6);
  });

  it("is above 0.5 for a persistent (trending) series", () => {
    // Cumulative sum of positively-autocorrelated increments is super-diffusive.
    const series = persistentSeries(3000, 0.6, 42);
    const h = hurstExponent(series);
    expect(h).toBeGreaterThan(0.5);
  });
});
