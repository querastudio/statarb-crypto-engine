import { NextResponse } from "next/server";
import { getOpenPositions, getClosedPositions } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read open + recently-closed auto-trader positions for the dashboard. */
export async function GET() {
  try {
    const [open, closed] = await Promise.all([
      getOpenPositions(),
      getClosedPositions(50),
    ]);
    return NextResponse.json({ ok: true, open, closed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
