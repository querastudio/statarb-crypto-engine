import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCHEMA_SQL = [
  `create table if not exists public.pairs (
    id uuid primary key default gen_random_uuid(),
    symbol_a text not null, symbol_b text not null,
    beta double precision not null, alpha double precision not null,
    adf_pvalue double precision not null, half_life double precision not null,
    hurst double precision not null, correlation double precision not null,
    score double precision not null, cointegrated boolean not null default true,
    timeframe text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists public.signals (
    id uuid primary key default gen_random_uuid(),
    symbol_a text not null, symbol_b text not null,
    side text not null, zscore double precision not null,
    beta double precision not null, spread double precision not null,
    price_a double precision not null, price_b double precision not null,
    note text, timeframe text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists public.backtests (
    id uuid primary key default gen_random_uuid(),
    symbol_a text not null, symbol_b text not null,
    metrics jsonb not null, metrics_gross jsonb not null,
    metrics_oos jsonb, params jsonb not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists public.blacklist (
    pair_key text primary key,
    created_at timestamptz not null default now()
  )`,
  // Tell PostgREST to reload its schema cache so the tables are immediately
  // accessible via the REST API (avoids PGRST204 "not in schema cache" errors).
  `select pg_notify('pgrst', 'reload schema')`,
];

/**
 * POST /api/setup
 * Body: { url, anonKey, serviceKey }
 * Tests the Supabase connection and auto-creates all required tables.
 */
export async function POST(req: NextRequest) {
  try {
    const { url, anonKey, serviceKey } = await req.json();

    if (!url || !serviceKey) {
      return NextResponse.json({ error: "url and serviceKey are required" }, { status: 400 });
    }

    const db = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Test connection with a simple query that always works regardless of schema.
    const { error: connErr } = await db.from("pairs").select("count").limit(1).maybeSingle();

    // Supabase/PostgREST returns different error codes depending on the situation:
    //   "42P01"    = PostgreSQL: table does not exist
    //   "PGRST204" = PostgREST: table not found in schema cache (same root cause)
    //   message containing "schema cache" = same issue
    // All of these mean "table missing → need to create schema".
    // Anything else (e.g., 401, JWT error) = bad credentials.
    const tableNotFound =
      !connErr ||
      connErr.code === "42P01" ||
      connErr.code === "PGRST204" ||
      connErr.message?.toLowerCase().includes("schema cache") ||
      connErr.message?.toLowerCase().includes("does not exist");

    if (connErr && !tableNotFound) {
      return NextResponse.json(
        { error: `Connection failed: ${connErr.message}` },
        { status: 400 },
      );
    }

    // Auto-create tables using Supabase's pg extension via rpc if available,
    // otherwise use the SQL API endpoint directly with the service role key.
    const createErrors: string[] = [];
    for (const sql of SCHEMA_SQL) {
      // Try via Supabase SQL API (service role bypasses RLS but not DDL via REST).
      // We use the raw fetch to Supabase's internal pg endpoint.
      const res = await fetch(`${url}/rest/v1/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ query: sql }),
      });
      void res; // We'll verify by selecting below instead.
    }

    // Verify tables exist and are visible to PostgREST's schema cache.
    // 42P01 = table does not exist in PostgreSQL.
    // PGRST204 / "schema cache" = table exists but PostgREST hasn't cached it yet.
    const tables = ["pairs", "signals", "backtests", "blacklist"];
    const missing: string[] = [];
    for (const table of tables) {
      const { error } = await db.from(table).select("*").limit(1);
      const notReady =
        error?.code === "42P01" ||
        error?.code === "PGRST204" ||
        error?.message?.toLowerCase().includes("schema cache");
      if (notReady) missing.push(table);
    }

    if (missing.length > 0) {
      // Include pg_notify so running the SQL also refreshes PostgREST's cache.
      return NextResponse.json({
        ok: false,
        connected: true,
        missingTables: missing,
        needsSchema: true,
        schemaSql: SCHEMA_SQL.join(";\n\n") + ";",
        supabaseUrl: url,
      });
    }

    return NextResponse.json({
      ok: true,
      connected: true,
      needsSchema: false,
      message: "Supabase connected and all tables exist!",
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
