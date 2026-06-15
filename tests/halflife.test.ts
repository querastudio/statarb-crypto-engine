import { describe, it, expect } from "vitest";
import { halfLife } from "@/lib/stats/halflife";
import { ar1, randomWalk } from "./helpers";

describe("Half-life (Ornstein-Uhlenbeck)", () => {
  it("returns a finite, small half-life for a fast mean-reverting series", () => {
    // phi = 0.5 → theoretical half-life = ln(2)/-ln(0.5) = 1 bar.
    const series = ar1(2000, 0.5, 314);
    const hl = halfLife(series);
    expect(Number.isFinite(hl)).toBe(true);
    expect(hl).toBeGreaterThan(0);
    expect(hl).toBeLessThan(3);
  });

  it("returns a larger half-life for a slower mean-reverting series", () => {
    // phi = 0.95 → half-life = ln(2)/-ln(0.95) ≈ 13.5 bars.
    const series = ar1(4000, 0.95, 271);
    const hl = halfLife(series);
    expect(hl).toBeGreaterThan(8);
    expect(hl).toBeLessThan(25);
  });

  it("returns a very large (or infinite) half-life for a random walk", () => {
    // A random walk has lambda ~ 0, so the estimated half-life is enormous and
    // well beyond any tradable window (the discovery filter caps it at ~30).
    const series = randomWalk(2000, 17);
    const hl = halfLife(series);
    expect(hl).toBeGreaterThan(100);
  });
});
