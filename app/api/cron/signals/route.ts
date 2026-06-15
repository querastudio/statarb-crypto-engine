import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth";
import { runSignals } from "@/lib/engine/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CRON: signal computation. Evaluates z-scores for stored pairs, persists
 * actionable signals, and dispatches Telegram alerts.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runSignals();
    return NextResponse.json({
      ok: true,
      evaluated: summary.evaluated,
      actionable: summary.signals.filter((s) => s.side !== "FLAT").length,
      alertsSent: summary.alertsSent,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
