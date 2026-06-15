import { describe, it, expect } from "vitest";
import { ols, linearRegression, invert } from "@/lib/stats/ols";

describe("OLS", () => {
  it("recovers known coefficients of a perfect linear relationship", () => {
    // y = 3 + 2x exactly.
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = x.map((xi) => 3 + 2 * xi);
    const { alpha, beta, result } = linearRegression(x, y);
    expect(alpha).toBeCloseTo(3, 6);
    expect(beta).toBeCloseTo(2, 6);
    expect(result.rSquared).toBeCloseTo(1, 6);
  });

  it("estimates coefficients with noise close to the truth", () => {
    const x = Array.from({ length: 200 }, (_, i) => i * 0.1);
    // y = 5 - 0.5x + small deterministic wiggle.
    const y = x.map((xi, i) => 5 - 0.5 * xi + (i % 2 === 0 ? 0.01 : -0.01));
    const { alpha, beta } = linearRegression(x, y);
    expect(alpha).toBeCloseTo(5, 1);
    expect(beta).toBeCloseTo(-0.5, 2);
  });

  it("inverts a matrix correctly", () => {
    const A = [
      [4, 7],
      [2, 6],
    ];
    const inv = invert(A);
    // A * inv should be identity.
    const prod = [
      [A[0][0] * inv[0][0] + A[0][1] * inv[1][0], A[0][0] * inv[0][1] + A[0][1] * inv[1][1]],
      [A[1][0] * inv[0][0] + A[1][1] * inv[1][0], A[1][0] * inv[0][1] + A[1][1] * inv[1][1]],
    ];
    expect(prod[0][0]).toBeCloseTo(1, 9);
    expect(prod[0][1]).toBeCloseTo(0, 9);
    expect(prod[1][0]).toBeCloseTo(0, 9);
    expect(prod[1][1]).toBeCloseTo(1, 9);
  });

  it("throws on a singular matrix", () => {
    expect(() => invert([[1, 2], [2, 4]])).toThrow();
  });

  it("produces multi-regressor estimates", () => {
    // y = 1 + 2*x1 + 3*x2
    const rows = [
      [1, 1, 1],
      [1, 2, 0],
      [1, 0, 2],
      [1, 3, 1],
      [1, 1, 3],
      [1, 4, 2],
    ];
    const y = rows.map((r) => 1 * r[0] + 2 * r[1] + 3 * r[2]);
    const fit = ols(rows, y);
    expect(fit.coefficients[0]).toBeCloseTo(1, 6);
    expect(fit.coefficients[1]).toBeCloseTo(2, 6);
    expect(fit.coefficients[2]).toBeCloseTo(3, 6);
  });
});
