import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runScan } from "@/lib/engine/run";
import type { Pair } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/scan-now
 * Body: { supabaseUrl: string, serviceKey: string, maxCombos?: number }
 *
 * Accepts the Supabase URL + service role key directly in the body so the
 * setup page can trigger a scan before SUPABASE_SERVICE_ROLE_KEY is set as
 * a Vercel env var (and before the user redeploys). The provided key is also
 * used to persist pairs if the env-var client isn't available.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabaseUrl, serviceKey, maxCombos } = (await req.json()) as {
      supabaseUrl?: string;
      serviceKey: string;
      maxCombos?: number;
    };

    if (!serviceKey) {
      return NextResponse.json({ error: "serviceKey required" }, { status: 400 });
    }

    // Validate against env var if set; if env var absent, trust the provided key.
    const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (expected && serviceKey !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const summary = await runScan(maxCombos);

    // If runScan() couldn't save (env var not set yet), retry with the key
    // supplied in the request body — works during initial setup before redeploy.
    if (!summary.saved && summary.pairsFound > 0) {
      const dbUrl = supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (dbUrl) {
        try {
          const db = createClient(dbUrl, serviceKey, { auth: { persistSession: false } });
          await db.from("pairs").delete().neq("symbol_a", "__none__");
          const rows = (summary.topPairs as Pair[]).map((p) => ({
            symbol_a: p.symbol_a,
            symbol_b: p.symbol_b,
            beta: p.beta,
            alpha: p.alpha,
            adf_pvalue: p.adf_pvalue,
            half_life: p.half_life,
            hurst: p.hurst,
            correlation: p.correlation,
            score: p.score,
            cointegrated: p.cointegrated,
            timeframe: p.timeframe,
            updated_at: new Date().toISOString(),
          }));
          const { error } = await db.from("pairs").insert(rows);
          if (!error) summary.saved = true;
        } catch {
          // best-effort; saved stays false
        }
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
