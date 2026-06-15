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

    // Fetch each symbol individually so we can surface per-symbol errors.
    const fetchErrors: string[] = [];
    const symbolResults = await Promise.allSettled(
      [symbolA, symbolB].map(async (sym) => {
        const { fetchOHLCV } = await import("@/lib/data/exchange");
        const bars = await fetchOHLCV(sym, undefined, lookbackBars);
        if (bars.length === 0) throw new Error(`No bars returned for ${sym}`);
        return { sym, bars };
      }),
    );
    for (const r of symbolResults) {
      if (r.status === "rejected") fetchErrors.push(String(r.reason));
    }
    if (fetchErrors.length > 0) {
      return NextResponse.json(
        { error: `Data fetch failed: ${fetchErrors.join(" | ")}` },
        { status: 422 },
      );
    }

    const matrix = await fetchAlignedCloses([symbolA, symbolB], undefined, lookbackBars);

    if (matrix.symbols.length < 2) {
      return NextResponse.json(
        {
          error: `Could not align data for both symbols. Fetched: ${matrix.symbols.join(", ") || "none"}`,
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
