// Rolling z-score of a series.
//
//   z_t = (x_t - rolling_mean_t) / rolling_std_t
//
// The rolling window uses the trailing `window` observations (inclusive of the
// current bar). The first `window-1` points are NaN (insufficient history).

export function rollingMean(series: number[], window: number): number[] {
  const out = new Array(series.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= window) sum -= series[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

export function rollingStd(series: number[], window: number): number[] {
  const out = new Array(series.length).fill(NaN);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    sumSq += series[i] * series[i];
    if (i >= window) {
      sum -= series[i - window];
      sumSq -= series[i - window] * series[i - window];
    }
    if (i >= window - 1) {
      const mean = sum / window;
      // Sample variance (n-1 denominator).
      const variance = (sumSq - window * mean * mean) / (window - 1);
      out[i] = variance > 0 ? Math.sqrt(variance) : 0;
    }
  }
  return out;
}

/** Rolling z-score using a trailing window. NaN where history is insufficient. */
export function rollingZScore(series: number[], window: number): number[] {
  if (window < 2) throw new Error("rollingZScore: window must be >= 2.");
  const mean = rollingMean(series, window);
  const sd = rollingStd(series, window);
  return series.map((x, i) => {
    if (Number.isNaN(mean[i]) || Number.isNaN(sd[i]) || sd[i] === 0) return NaN;
    return (x - mean[i]) / sd[i];
  });
}

/** Latest (most recent) finite z-score from a series, or NaN if none. */
export function latestZScore(series: number[], window: number): number {
  const z = rollingZScore(series, window);
  for (let i = z.length - 1; i >= 0; i--) {
    if (Number.isFinite(z[i])) return z[i];
  }
  return NaN;
}
