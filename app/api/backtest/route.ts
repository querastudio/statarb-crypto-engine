import { NextRequest, NextResponse } from "next/server";
import { fetchAlignedCloses } from "@/lib/data/exchange";
import { backtestPair } from "@/lib/engine/backtest";
import { saveBacktest } from "@/lib/db/supabase";
import type { BacktestParams } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Sensible default for the backtest route: enough bars for a 60-bar z-score
// window with solid OOS data, but small enough to fetch fast on Vercel Hobby.
const BACKTEST_DEFAULT_BARS = 300;
const MIN_BARS = 80;

/**
 * POST /api/backtest
 * Body: { symbolA, symbolB, lookbackBars?: number, params?: Partial<BacktestParams> }
 * Fetches fresh OHLCV in parallel, runs the event-driven backtest, persists summary.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbolA: string = body.symbolA;
    const symbolB: string = body.symbolB;
    const lookbackBars: number = Number(body.lookbackBars ?? BACKTEST_DEFAULT_BARS);
    const overrides: Partial<BacktestParams> = body.params ?? {};

    if (!symbolA || !symbolB) {
      return NextResponse.json({ error: "symbolA and symbolB are required" }, { status: 400 });
    }

    const matrix = await fetchAlignedCloses([symbolA, symbolB], undefined, lookbackBars);

    if (matrix.symbols.length < 2) {
      return NextResponse.json(
        {
          error: `Could not fetch data for both symbols. Check symbol names (e.g. "ETH/USDT") and try again. Fetched: ${matrix.symbols.join(", ") || "none"}`,
        },
        { status: 422 },
      );
    }

    if (matrix.timestamps.length < MIN_BARS) {
      return NextResponse.json(
        {
          error: `Only ${matrix.timestamps.length} aligned bars available (need ${MIN_BARS}). Try increasing Lookback bars or use more liquid symbols.`,
        },
        { status: 422 },
      );
    }

    const ia = matrix.symbols.indexOf(symbolA);
    const ib = matrix.symbols.indexOf(symbolB);
    const result = backtestPair(
      symbolA,
      symbolB,
      matrix.closes[ia],
      matrix.closes[ib],
      matrix.timestamps,
      overrides,
    );

    // Best-effort persistence (no-op if Supabase unconfigured).
    try {
      await saveBacktest(result);
    } catch {
      /* ignore */
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
