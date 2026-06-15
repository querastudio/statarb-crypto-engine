// Ordinary Least Squares regression with standard errors and t-statistics.
// Implemented natively (no native deps) so it runs in Vercel serverless.
//
// Model:  y = X b + e ,  where X is n x k (caller includes an intercept column
// if desired). Solved via the normal equations  b = (X'X)^-1 X'y  using
// Gauss-Jordan elimination for the inverse.

export interface OLSResult {
  /** Estimated coefficients, length k. */
  coefficients: number[];
  /** Standard errors of the coefficients, length k. */
  standardErrors: number[];
  /** t-statistics = coefficient / standardError, length k. */
  tStats: number[];
  /** Residuals, length n. */
  residuals: number[];
  /** Residual sum of squares. */
  rss: number;
  /** R-squared. */
  rSquared: number;
  /** Degrees of freedom = n - k. */
  df: number;
  /** Number of observations. */
  nobs: number;
}

/** Multiply matrix A (n x m) by matrix B (m x p). */
function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B.length;
  const p = B[0].length;
  const out: number[][] = Array.from({ length: n }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      const a = A[i][k];
      if (a === 0) continue;
      for (let j = 0; j < p; j++) {
        out[i][j] += a * B[k][j];
      }
    }
  }
  return out;
}

function transpose(A: number[][]): number[][] {
  const n = A.length;
  const m = A[0].length;
  const out: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[j][i] = A[i][j];
  return out;
}

/** Invert a square matrix via Gauss-Jordan elimination with partial pivoting. */
export function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  // Augment [A | I]
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find row with largest absolute value in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("Matrix is singular or near-singular; cannot invert.");
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const pivVal = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= pivVal;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row.slice(n));
}

/**
 * Fit OLS. `X` is an n x k design matrix (caller supplies intercept column),
 * `y` is the length-n response vector.
 */
export function ols(X: number[][], y: number[]): OLSResult {
  const n = X.length;
  if (n === 0) throw new Error("OLS: empty design matrix.");
  const k = X[0].length;
  if (y.length !== n) throw new Error("OLS: X and y length mismatch.");
  if (n <= k) throw new Error("OLS: not enough observations for parameters.");

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXInv = invert(XtX);
  const yCol = y.map((v) => [v]);
  const Xty = matMul(Xt, yCol);
  const bCol = matMul(XtXInv, Xty);
  const coefficients = bCol.map((r) => r[0]);

  // Residuals and RSS.
  const residuals = new Array(n);
  let rss = 0;
  for (let i = 0; i < n; i++) {
    let pred = 0;
    for (let j = 0; j < k; j++) pred += X[i][j] * coefficients[j];
    const e = y[i] - pred;
    residuals[i] = e;
    rss += e * e;
  }

  const df = n - k;
  const sigma2 = rss / df;

  // Standard errors = sqrt(diag(sigma2 * (X'X)^-1)).
  const standardErrors = new Array(k);
  const tStats = new Array(k);
  for (let j = 0; j < k; j++) {
    const variance = sigma2 * XtXInv[j][j];
    const se = variance > 0 ? Math.sqrt(variance) : 0;
    standardErrors[j] = se;
    tStats[j] = se > 0 ? coefficients[j] / se : 0;
  }

  // R-squared.
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let tss = 0;
  for (let i = 0; i < n; i++) tss += (y[i] - meanY) ** 2;
  const rSquared = tss > 0 ? 1 - rss / tss : 0;

  return { coefficients, standardErrors, tStats, residuals, rss, rSquared, df, nobs: n };
}

/** Convenience: simple linear regression y = alpha + beta * x. */
export function linearRegression(
  x: number[],
  y: number[],
): { alpha: number; beta: number; result: OLSResult } {
  const X = x.map((xi) => [1, xi]);
  const result = ols(X, y);
  return { alpha: result.coefficients[0], beta: result.coefficients[1], result };
}
