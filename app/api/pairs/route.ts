import { NextResponse } from "next/server";
import { getPairs, isSupabaseConfigured } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const pairs = await getPairs(200);
    return NextResponse.json({ configured: isSupabaseConfigured(), pairs });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, pairs: [], configured: isSupabaseConfigured() },
      { status: 500 },
    );
  }
}
