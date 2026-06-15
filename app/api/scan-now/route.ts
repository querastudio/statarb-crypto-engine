import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/engine/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/scan-now
 * Body: { serviceKey: string, maxCombos?: number }
 *
 * Authenticates using SUPABASE_SERVICE_ROLE_KEY so the setup page can trigger
 * a scan manually without needing the CRON_SECRET header that Vercel Cron sends.
 */
export async function POST(req: NextRequest) {
  try {
    const { serviceKey, maxCombos } = (await req.json()) as {
      serviceKey: string;
      maxCombos?: number;
    };

    const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (expected && serviceKey !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!expected && !serviceKey) {
      return NextResponse.json({ error: "serviceKey required" }, { status: 400 });
    }

    const summary = await runScan(maxCombos);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
