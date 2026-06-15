import { NextRequest, NextResponse } from "next/server";
import { fetchAlignedCloses } from "@/lib/data/exchange";
import { backtestPair } from "@/lib/engine/backtest";
import { saveBacktest } from "@/lib/db/supabase";
import type { BacktestParams } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/backtest
 * Body: { symbolA, symbolB, params?: Partial<BacktestParams> }
 * Fetches fresh OHLCV, runs the event-driven backtest, persists the summary.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbolA: string = body.symbolA;
    const symbolB: string = body.symbolB;
    const overrides: Partial<BacktestParams> = body.params ?? {};

    if (!symbolA || !symbolB) {
      return NextResponse.json({ error: "symbolA and symbolB are required" }, { status: 400 });
    }

    const matrix = await fetchAlignedCloses([symbolA, symbolB]);
    if (matrix.symbols.length < 2 || matrix.timestamps.length < 80) {
      return NextResponse.json(
        { error: "Insufficient aligned data for these symbols." },
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
