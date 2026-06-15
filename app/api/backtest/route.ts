import { NextRequest, NextResponse } from "next/server";
import { fetchAlignedCloses } from "@/lib/data/exchange";
import { backtestPair } from "@/lib/engine/backtest";
import { walkForward } from "@/lib/engine/walkforward";
import { saveBacktest } from "@/lib/db/supabase";
import type { BacktestParams } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BACKTEST_DEFAULT_BARS = 300;
const MIN_BARS = 80;

/**
 * POST /api/backtest
 * Body: { symbolA, symbolB, lookbackBars?: number, params?: Partial<BacktestParams> }
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
          error: `Could not fetch data for one or both symbols. Fetched: [${matrix.symbols.join(", ") || "none"}]. ` +
            `Check symbol format (e.g. "ETH/USDT") and ensure the pair is listed on Bybit or OKX.`,
        },
        { status: 422 },
      );
    }

    if (matrix.timestamps.length < MIN_BARS) {
      return NextResponse.json(
        {
          error: `Only ${matrix.timestamps.length} aligned bars (need ${MIN_BARS}). ` +
            `Try increasing Lookback bars or use a more liquid pair.`,
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

    const wf = walkForward(result, 4);
    const finalResult = { ...result, walkForward: wf };

    try {
      await saveBacktest(result);
    } catch {
      /* best-effort */
    }

    return NextResponse.json(finalResult);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
