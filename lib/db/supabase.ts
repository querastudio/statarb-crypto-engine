// Supabase client + persistence helpers. Vercel is stateless, so all engine
// state (pairs, signals, backtests, blacklist) lives here.
//
// Two clients:
//   - browser/anon: read-only dashboard queries (NEXT_PUBLIC_* keys)
//   - service:      server-side writes from cron (SERVICE_ROLE key, never
//                   exposed to the browser)
//
// If Supabase env vars are absent the helpers degrade gracefully (return empty
// / no-op) so the app still boots for local exploration.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Pair, Signal, BacktestResult, Position } from "@/lib/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && (anonKey || serviceKey));
}

let browserClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

/** Read client (anon). Returns null if not configured. */
export function getBrowserClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!browserClient) browserClient = createClient(url, anonKey);
  return browserClient;
}

/** Server write client (service role). Returns null if not configured. */
export function getServiceClient(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  if (!serviceClient) {
    serviceClient = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }
  return serviceClient;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getPairs(limit = 100): Promise<Pair[]> {
  // Prefer service client so server-side reads bypass RLS even when no policy is set.
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return [];
  const { data, error } = await db
    .from("pairs")
    .select("*")
    .order("score", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Pair[];
}

export async function getSignals(limit = 100): Promise<Signal[]> {
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return [];
  const { data, error } = await db
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Signal[];
}

export async function getBlacklist(): Promise<string[]> {
  const db = getBrowserClient() ?? getServiceClient();
  if (!db) return [];
  const { data, error } = await db.from("blacklist").select("pair_key");
  if (error) return [];
  return (data ?? []).map((r: { pair_key: string }) => r.pair_key);
}

// ── Writes (service role) ────────────────────────────────────────────────────

/** Replace the stored pair set with a freshly discovered ranked list. */
export async function savePairs(pairs: Pair[]): Promise<void> {
  const db = getServiceClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured — cannot save pairs");
  // Clear previous scan, then insert the new ranked set.
  await db.from("pairs").delete().neq("symbol_a", "__none__");
  if (pairs.length === 0) return;
  const rows = pairs.map((p) => ({
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
  if (error) throw error;
}

export async function saveSignals(signals: Signal[]): Promise<void> {
  const db = getServiceClient();
  if (!db || signals.length === 0) return;
  const rows = signals.map((s) => ({ ...s, created_at: new Date().toISOString() }));
  const { error } = await db.from("signals").insert(rows);
  if (error) throw error;
}

export async function saveBacktest(result: BacktestResult): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  const { error } = await db.from("backtests").insert({
    symbol_a: result.symbol_a,
    symbol_b: result.symbol_b,
    metrics: result.metrics,
    metrics_gross: result.metricsGross,
    metrics_oos: result.metricsOOS,
    params: result.params,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function addToBlacklist(pairKey: string): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  await db.from("blacklist").upsert({ pair_key: pairKey, created_at: new Date().toISOString() });
}

export function pairKey(symbolA: string, symbolB: string): string {
  return `${symbolA}__${symbolB}`;
}

// ── Positions (auto-trader) ───────────────────────────────────────────────────

/** All open positions for the given mode (paper/testnet/live kept separate). */
export async function getOpenPositions(mode?: string): Promise<Position[]> {
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return [];
  let q = db.from("positions").select("*").eq("status", "open");
  if (mode) q = q.eq("mode", mode);
  const { data, error } = await q.order("opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Position[];
}

/** Recently closed positions (for dashboard history). */
export async function getClosedPositions(limit = 50): Promise<Position[]> {
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return [];
  const { data, error } = await db
    .from("positions")
    .select("*")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Position[];
}

/**
 * Sum realized net PnL of positions closed at/after `sinceISO` for a mode.
 * Used by the daily-loss circuit breaker. Returns 0 if DB is unavailable.
 */
export async function getRealizedPnlSince(mode: string, sinceISO: string): Promise<number> {
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return 0;
  const { data, error } = await db
    .from("positions")
    .select("pnl")
    .eq("status", "closed")
    .eq("mode", mode)
    .gte("closed_at", sinceISO);
  if (error) throw error;
  return (data ?? []).reduce((s, r: { pnl: number | null }) => s + (Number(r.pnl) || 0), 0);
}

/** Insert a freshly opened position. Returns the stored row (with id). */
export async function openPosition(pos: Position): Promise<Position> {
  const db = getServiceClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured — cannot open position");
  const { data, error } = await db
    .from("positions")
    .insert({
      symbol_a: pos.symbol_a,
      symbol_b: pos.symbol_b,
      side: pos.side,
      qty_a: pos.qty_a,
      qty_b: pos.qty_b,
      entry_price_a: pos.entry_price_a,
      entry_price_b: pos.entry_price_b,
      entry_z: pos.entry_z,
      beta: pos.beta,
      half_life: pos.half_life,
      status: "open",
      mode: pos.mode,
      opened_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as Position;
}

/** Mark a position closed with exit details. */
export async function closePosition(
  id: string,
  exit: { exit_price_a: number; exit_price_b: number; exit_z: number; exit_reason: string; pnl: number },
): Promise<void> {
  const db = getServiceClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured — cannot close position");
  const { error } = await db
    .from("positions")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      exit_price_a: exit.exit_price_a,
      exit_price_b: exit.exit_price_b,
      exit_z: exit.exit_z,
      exit_reason: exit.exit_reason,
      pnl: exit.pnl,
    })
    .eq("id", id);
  if (error) throw error;
}
