// Small formatting helpers shared across UI components.

export function pct(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(digits)}%`;
}

export function num(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "n/a";
  return x.toFixed(digits);
}

export function signClass(x: number): string {
  if (!Number.isFinite(x) || x === 0) return "";
  return x > 0 ? "pos" : "neg";
}

export function sideBadgeClass(side: string): string {
  switch (side) {
    case "LONG_SPREAD":
      return "badge long";
    case "SHORT_SPREAD":
      return "badge short";
    case "CLOSE":
      return "badge close";
    case "STOP":
      return "badge stop";
    default:
      return "badge flat";
  }
}

export function sideLabel(side: string): string {
  switch (side) {
    case "LONG_SPREAD":
      return "LONG";
    case "SHORT_SPREAD":
      return "SHORT";
    case "CLOSE":
      return "CLOSE";
    case "STOP":
      return "STOP";
    default:
      return "FLAT";
  }
}

// ── Metric quality grading (for color-coded UI) ────────────────────────────────
// Each returns a quality tier so the UI can show ✓ / ~ / ✗ and a color.

export type Quality = "good" | "ok" | "weak";

export function qualityClass(q: Quality): string {
  return q === "good" ? "pos" : q === "weak" ? "neg" : "muted";
}

export function qualityIcon(q: Quality): string {
  return q === "good" ? "✓" : q === "weak" ? "✗" : "~";
}

/** ADF p-value: lower = stronger evidence of mean reversion. */
export function adfQuality(p: number): Quality {
  if (p <= 0.01) return "good";
  if (p <= 0.05) return "ok";
  return "weak";
}

/** Half-life (bars): ideal is a few-to-tens of bars; too short=noise, too long=slow. */
export function halfLifeQuality(hl: number): Quality {
  if (hl >= 2 && hl <= 30) return "good";
  if (hl > 30 && hl <= 120) return "ok";
  return "weak";
}

/** Hurst: <0.5 = mean-reverting (good); closer to 0 is stronger. */
export function hurstQuality(h: number): Quality {
  if (h < 0.4) return "good";
  if (h < 0.5) return "ok";
  return "weak";
}

/** Absolute correlation: higher = the two move together more tightly. */
export function corrQuality(c: number): Quality {
  const a = Math.abs(c);
  if (a >= 0.85) return "good";
  if (a >= 0.7) return "ok";
  return "weak";
}

/** Composite score 0..1. */
export function scoreQuality(s: number): Quality {
  if (s >= 0.6) return "good";
  if (s >= 0.45) return "ok";
  return "weak";
}
