import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth";
import { runScan, runScanChunk } from "@/lib/engine/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CRON: pair discovery.
 *
 * Single-pass mode (default):
 *   GET /api/cron/scan[?maxCombos=N]   — scan whole universe in one request.
 *
 * Chunked mode (for large universes that exceed the 60s limit):
 *   GET /api/cron/scan?chunk=K&chunks=N
 *   Call sequentially for K = 0..N-1. Chunk 0 pins the universe and clears
 *   prior state; the final chunk runs BH over all candidates and saves pairs.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const chunkRaw = url.searchParams.get("chunk");
    const chunksRaw = url.searchParams.get("chunks");

    if (chunkRaw !== null && chunksRaw !== null) {
      const summary = await runScanChunk(Number(chunkRaw), Number(chunksRaw));
      return NextResponse.json({ ok: true, ...summary });
    }

    const maxCombosRaw = url.searchParams.get("maxCombos");
    const maxCombos = maxCombosRaw ? Number(maxCombosRaw) : undefined;
    const summary = await runScan(maxCombos);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
