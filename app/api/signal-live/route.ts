import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { fetchOHLCV } from "@/lib/data/exchange";
import { buildSpreadSeries, classify } from "@/lib/engine/signals";
import { detectRegime } from "@/lib/engine/regime";
import type { OHLCV } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/signal-live?a=ETH/USDT&b=BTC/USDT
 *
 * Computes the CURRENT trading signal for a pair from fresh prices:
 * builds the Kalman spread, the rolling z-score, classifies the latest bar,
 * and returns the z-score history so the UI can draw a gauge + sparkline.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const a = url.searchParams.get("a");
    const b = url.searchParams.get("b");
    if (!a || !b) {
      return NextResponse.json({ error: "query params a and b are required" }, { status: 400 });
    }

    const LOOKBACK = 200;
    const [barsA, barsB] = await Promise.all([
      fetchOHLCV(a, config.timeframe, LOOKBACK),
      fetchOHLCV(b, config.timeframe, LOOKBACK),
    ]);

    // Align on common timestamps.
    const mapB = new Map<number, OHLCV>(barsB.map((x) => [x.timestamp, x]));
    const closesA: number[] = [];
    const closesB: number[] = [];
    const times: number[] = [];
    for (const x of barsA) {
      const y = mapB.get(x.timestamp);
      if (!y) continue;
      closesA.push(x.close);
      closesB.push(y.close);
      times.push(x.timestamp);
    }

    if (closesA.length < config.zscoreWindow + 2) {
      return NextResponse.json(
        { error: `Not enough aligned bars (${closesA.length})` },
        { status: 422 },
      );
    }

    const { beta, spread, zscore } = buildSpreadSeries(closesA, closesB, {
      useKalman: true,
      window: config.zscoreWindow,
    });

    const thresholds = {
      zscoreWindow: config.zscoreWindow,
      entryThreshold: config.entryThreshold,
      exitThreshold: config.exitThreshold,
      stopThreshold: config.stopThreshold,
    };

    const lastIdx = zscore.length - 1;
    const z = zscore[lastIdx];
    const side = classify(z, thresholds);
    const regime = detectRegime(spread, zscore);

    // Trim the z-score history to the valid (non-NaN) tail for a clean sparkline.
    const history: Array<{ t: number; z: number }> = [];
    for (let i = 0; i < zscore.length; i++) {
      if (Number.isFinite(zscore[i])) history.push({ t: times[i], z: zscore[i] });
    }

    return NextResponse.json({
      symbol_a: a,
      symbol_b: b,
      side,
      zscore: z,
      beta: beta[lastIdx],
      spread: spread[lastIdx],
      price_a: closesA[closesA.length - 1],
      price_b: closesB[closesB.length - 1],
      thresholds,
      history: history.slice(-120),
      asOf: times[times.length - 1],
      regime,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
