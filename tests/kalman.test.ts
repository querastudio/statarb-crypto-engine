import { describe, it, expect } from "vitest";
import { kalmanHedgeRatio } from "@/lib/stats/kalman";
import { mulberry32, gaussian } from "./helpers";

describe("Kalman filter hedge ratio", () => {
  it("converges toward a constant true hedge ratio", () => {
    const rng = mulberry32(2024);
    const n = 1500;
    const beta = 2.0;
    const alpha = 5.0;
    const priceB: number[] = [];
    const priceA: number[] = [];
    let b = 100;
    for (let i = 0; i < n; i++) {
      b += gaussian(rng) * 0.5;
      priceB.push(b);
      priceA.push(alpha + beta * b + gaussian(rng) * 0.5);
    }
    const res = kalmanHedgeRatio(priceA, priceB, { delta: 1e-5, R: 0.25 });
    const finalBeta = res.beta[res.beta.length - 1];
    // Should track the true slope closely after convergence.
    expect(finalBeta).toBeGreaterThan(1.7);
    expect(finalBeta).toBeLessThan(2.3);
  });

  it("adapts beta when the true ratio changes mid-series", () => {
    const rng = mulberry32(77);
    const n = 2000;
    const priceB: number[] = [];
    const priceA: number[] = [];
    let b = 100;
    for (let i = 0; i < n; i++) {
      b += gaussian(rng) * 0.5;
      priceB.push(b);
      const trueBeta = i < n / 2 ? 1.0 : 3.0; // regime shift
      priceA.push(trueBeta * b + gaussian(rng) * 0.3);
    }
    const res = kalmanHedgeRatio(priceA, priceB, { delta: 1e-3, R: 0.1 });
    const early = res.beta[Math.floor(n / 2) - 1];
    const late = res.beta[n - 1];
    // Beta should move materially upward after the regime change.
    expect(late - early).toBeGreaterThan(1.0);
  });

  it("returns one step per observation", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 4, 6, 8, 10];
    const res = kalmanHedgeRatio(a, b);
    expect(res.steps.length).toBe(5);
    expect(res.beta.length).toBe(5);
    expect(res.spread.length).toBe(5);
  });
});
