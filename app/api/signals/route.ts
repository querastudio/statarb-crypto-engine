import { NextResponse } from "next/server";
import { getSignals, isSupabaseConfigured } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const signals = await getSignals(200);
    return NextResponse.json({ configured: isSupabaseConfigured(), signals });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, signals: [], configured: isSupabaseConfigured() },
      { status: 500 },
    );
  }
}
