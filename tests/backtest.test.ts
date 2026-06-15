import { describe, it, expect } from "vitest";
import { backtestPair } from "@/lib/engine/backtest";
import { sizePosition, evaluateBreakGuard, canOpenPosition } from "@/lib/risk/sizing";
import { cointegratedPair } from "./helpers";

describe("Backtest engine", () => {
  it("runs on a cointegrated pair and produces a full result", () => {
    const { a, b } = cointegratedPair(800, 1.2, 8, 2026, 2);
    const res = backtestPair("A/USDT", "B/USDT", a, b, undefined, { useKalman: true });

    expect(res.equityCurve.length).toBe(a.length);
    expect(res.metrics.totalTrades).toBeGreaterThan(0);
    expect(Number.isFinite(res.metrics.sharpe)).toBe(true);
    expect(res.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(res.metrics.maxDrawdown).toBeLessThanOrEqual(1);
    // Net total return must be <= gross (costs only subtract).
    expect(res.metrics.totalReturn).toBeLessThanOrEqual(res.metricsGross.totalReturn + 1e-9);
  });

  it("charges costs: gross outperforms net", () => {
    const { a, b } = cointegratedPair(800, 0.9, 4, 31337, 2);
    const res = backtestPair("X/USDT", "Y/USDT", a, b);
    expect(res.metricsGross.totalReturn).toBeGreaterThanOrEqual(res.metrics.totalReturn);
  });

  it("produces an out-of-sample metric slice", () => {
    const { a, b } = cointegratedPair(1000, 1.0, 0, 7, 2);
    const res = backtestPair("X/USDT", "Y/USDT", a, b, undefined, { trainFraction: 0.6 });
    expect(res.oosStartIndex).toBe(600);
    expect(res.metricsOOS).toBeDefined();
  });
});

describe("Risk management", () => {
  it("sizes a position to risk the configured fraction at the stop", () => {
    const r = sizePosition({
      equity: 10000,
      priceA: 100,
      priceB: 50,
      beta: 1.5,
      spreadStopDistance: 5,
      riskPerTrade: 0.01,
    });
    // capitalAtRisk = 1% of 10000 = 100; unitsA = 100/5 = 20
    expect(r.capitalAtRisk).toBeCloseTo(100, 6);
    expect(r.unitsA).toBeCloseTo(20, 6);
    expect(r.unitsB).toBeCloseTo(30, 6); // 20 * 1.5
  });

  it("enforces max concurrent positions", () => {
    expect(canOpenPosition(0)).toBe(true);
    expect(canOpenPosition(9999)).toBe(false);
  });

  it("closes & blacklists when cointegration breaks", () => {
    const g = evaluateBreakGuard({ adfPValue: 0.9, barsHeld: 5, halfLife: 10, absZScore: 1 });
    expect(g.shouldClose).toBe(true);
    expect(g.shouldBlacklist).toBe(true);
  });

  it("time-stops a stale position", () => {
    const g = evaluateBreakGuard({ adfPValue: 0.01, barsHeld: 25, halfLife: 10, absZScore: 1 });
    expect(g.shouldClose).toBe(true);
    expect(g.shouldBlacklist).toBe(false);
    expect(g.reason).toContain("time stop");
  });
});
