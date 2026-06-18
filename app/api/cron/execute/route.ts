import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth";
import { runExecutor } from "@/lib/exec/executor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CRON: auto-trade executor. Opens/closes Bybit perpetual spread positions for
 * stored pairs based on the latest z-score. Guarded by the master kill switch
 * (TRADING_ENABLED) and the trading mode (paper/testnet/live).
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runExecutor();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
