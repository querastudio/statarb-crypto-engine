// Deterministic test helpers: seeded RNG and synthetic series generators.

/** Mulberry32 — small, fast, deterministic PRNG returning [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal draw via Box-Muller using a uniform generator. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A pure random walk (unit-root, non-stationary). */
export function randomWalk(n: number, seed: number, drift = 0, sigma = 1): number[] {
  const rng = mulberry32(seed);
  const out = new Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) {
    x += drift + sigma * gaussian(rng);
    out[i] = x;
  }
  return out;
}

/** A stationary AR(1):  x_t = phi·x_{t-1} + noise,  |phi| < 1. */
export function ar1(n: number, phi: number, seed: number, sigma = 1): number[] {
  const rng = mulberry32(seed);
  const out = new Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = phi * x + sigma * gaussian(rng);
    out[i] = x;
  }
  return out;
}

/**
 * Build a cointegrated pair: B is a random walk, A = alpha + beta*B +
 * stationary noise. The spread A - beta*B is stationary by construction.
 */
export function cointegratedPair(
  n: number,
  beta: number,
  alpha: number,
  seed: number,
  noiseSigma = 1,
): { a: number[]; b: number[] } {
  const b = randomWalk(n, seed, 0.05, 1).map((v) => v + 100); // keep prices positive
  const noiseRng = mulberry32(seed + 7919);
  const a = b.map((bi) => alpha + beta * bi + noiseSigma * gaussian(noiseRng));
  return { a, b };
}
