import { NextRequest, NextResponse } from "next/server";
import { openPosition, getServiceClient } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Seed (or clear) a DEMO position so the /positions UI can be previewed before a
 * real entry signal fires. Demo rows use DEMO* symbols so the live executor
 * skips them (no price data) and they're trivial to clean up.
 *
 *   GET /api/positions/demo?secret=CRON_SECRET        → insert one demo position
 *   GET /api/positions/demo?secret=CRON_SECRET&clear=1 → remove all demo rows
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.nextUrl.searchParams.get("secret");
  if (secret && given !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceClient();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 },
    );
  }

  // Clear mode: delete every demo row (open or closed).
  if (req.nextUrl.searchParams.get("clear")) {
    const { error } = await db.from("positions").delete().like("symbol_a", "DEMO%");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: true });
  }

  // Insert a realistic-looking demo LONG_SPREAD position (paper mode).
  try {
    const demo = await openPosition({
      symbol_a: "DEMOBTC/USDT",
      symbol_b: "DEMOETH/USDT",
      side: "LONG_SPREAD",
      qty_a: 0.015,
      qty_b: 0.34,
      entry_price_a: 64250,
      entry_price_b: 3180,
      entry_z: -2.31,
      beta: 0.82,
      half_life: 18,
      status: "open",
      mode: "paper",
    });
    return NextResponse.json({
      ok: true,
      demo,
      note: "Buka /positions untuk melihatnya. Hapus dengan ?clear=1.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
