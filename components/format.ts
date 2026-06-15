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
