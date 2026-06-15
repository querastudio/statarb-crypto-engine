// Kalman filter for a dynamically-updating hedge ratio (pairs trading).
//
// State-space model (following Chan, "Algorithmic Trading"):
//   Observation:  y_t = x_t · β_t + ε_t,   ε_t ~ N(0, R)
//   where x_t = [1, price_B_t] (intercept + slope) and y_t = price_A_t.
//   State:        β_t = β_{t-1} + ω_t,      ω_t ~ N(0, Q)
//
// The transition matrix is the identity (random-walk state). Process noise
// Q = (delta / (1 - delta)) · I controls how fast β adapts; R is the
// observation-noise variance.
//
// At each step we expose the predicted measurement error (the "forecast
// residual"), which is the dynamic spread used for z-scoring.

export interface KalmanOptions {
  /** Adaptation speed of the state, in (0,1). Larger = β moves faster. */
  delta?: number;
  /** Observation-noise variance. */
  R?: number;
  /** Initial state covariance scale. */
  initialP?: number;
}

export interface KalmanStep {
  /** Estimated intercept after this observation. */
  alpha: number;
  /** Estimated hedge ratio (slope on price_B) after this observation. */
  beta: number;
  /** Forecast error e_t = y_t - x_t·β_{t|t-1}  (the dynamic spread). */
  spread: number;
  /** Forecast error variance Q_t (a.k.a. innovation variance). */
  spreadVar: number;
}

export interface KalmanResult {
  steps: KalmanStep[];
  /** Convenience arrays. */
  beta: number[];
  alpha: number[];
  spread: number[];
}

/**
 * Run the Kalman filter over aligned price series. priceA is the dependent
 * variable (y), priceB the independent (x).
 */
export function kalmanHedgeRatio(
  priceA: number[],
  priceB: number[],
  options: KalmanOptions = {},
): KalmanResult {
  if (priceA.length !== priceB.length) {
    throw new Error("kalmanHedgeRatio: series length mismatch.");
  }
  const n = priceA.length;
  const delta = options.delta ?? 1e-4;
  const R = options.R ?? 1e-3;
  const initialP = options.initialP ?? 1.0;

  // State vector beta = [intercept, slope].
  let stateInt = 0;
  let stateSlope = 0;
  // 2x2 state covariance P.
  let P = [
    [initialP, 0],
    [0, initialP],
  ];
  // Process-noise covariance Q (diagonal).
  const q = delta / (1 - delta);
  const Q = [
    [q, 0],
    [0, q],
  ];

  const steps: KalmanStep[] = [];
  const betaArr: number[] = [];
  const alphaArr: number[] = [];
  const spreadArr: number[] = [];

  for (let t = 0; t < n; t++) {
    // Predict: state unchanged (identity transition), covariance grows by Q.
    const Pp = [
      [P[0][0] + Q[0][0], P[0][1] + Q[0][1]],
      [P[1][0] + Q[1][0], P[1][1] + Q[1][1]],
    ];

    // Observation row H = [1, price_B].
    const h0 = 1;
    const h1 = priceB[t];

    // Predicted measurement and innovation.
    const yHat = h0 * stateInt + h1 * stateSlope;
    const innovation = priceA[t] - yHat; // the dynamic spread

    // Innovation variance S = H Pp H' + R.
    // H Pp = [h0*Pp00 + h1*Pp10, h0*Pp01 + h1*Pp11]
    const HPp0 = h0 * Pp[0][0] + h1 * Pp[1][0];
    const HPp1 = h0 * Pp[0][1] + h1 * Pp[1][1];
    const S = HPp0 * h0 + HPp1 * h1 + R;

    // Kalman gain K = Pp H' / S  (2x1).
    const PpHt0 = Pp[0][0] * h0 + Pp[0][1] * h1;
    const PpHt1 = Pp[1][0] * h0 + Pp[1][1] * h1;
    const K0 = PpHt0 / S;
    const K1 = PpHt1 / S;

    // Update state.
    stateInt = stateInt + K0 * innovation;
    stateSlope = stateSlope + K1 * innovation;

    // Update covariance P = (I - K H) Pp.
    // K H = [[K0*h0, K0*h1],[K1*h0, K1*h1]]
    const ImKH = [
      [1 - K0 * h0, -K0 * h1],
      [-K1 * h0, 1 - K1 * h1],
    ];
    P = [
      [
        ImKH[0][0] * Pp[0][0] + ImKH[0][1] * Pp[1][0],
        ImKH[0][0] * Pp[0][1] + ImKH[0][1] * Pp[1][1],
      ],
      [
        ImKH[1][0] * Pp[0][0] + ImKH[1][1] * Pp[1][0],
        ImKH[1][0] * Pp[0][1] + ImKH[1][1] * Pp[1][1],
      ],
    ];

    steps.push({ alpha: stateInt, beta: stateSlope, spread: innovation, spreadVar: S });
    alphaArr.push(stateInt);
    betaArr.push(stateSlope);
    spreadArr.push(innovation);
  }

  return { steps, beta: betaArr, alpha: alphaArr, spread: spreadArr };
}
