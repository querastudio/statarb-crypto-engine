import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth";
import { runScan } from "@/lib/engine/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CRON: pair discovery. Scans the liquid universe for cointegrated pairs and
 * persists the ranked set. `?maxCombos=N` bounds work to fit the time budget.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const maxCombosRaw = url.searchParams.get("maxCombos");
    const maxCombos = maxCombosRaw ? Number(maxCombosRaw) : undefined;
    const summary = await runScan(maxCombos);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
