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
import type { Pair, Signal, BacktestResult, ScanCandidate } from "@/lib/types";

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

// ── Chunked-scan state (service role) ─────────────────────────────────────────

/** Pin the exact symbol ordering for a chunked scan session (single row, id=1). */
export async function setScanSession(symbols: string[]): Promise<void> {
  const db = getServiceClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured — cannot start scan session");
  const { error } = await db
    .from("scan_session")
    .upsert({ id: 1, symbols, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Read the pinned symbol ordering for the current chunked scan session. */
export async function getScanSession(): Promise<string[]> {
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return [];
  const { data, error } = await db
    .from("scan_session")
    .select("symbols")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return [];
  return ((data as { symbols: string[] }).symbols) ?? [];
}

/** Wipe accumulated candidates (called at the start of a fresh scan). */
export async function clearScanCandidates(): Promise<void> {
  const db = getServiceClient();
  if (!db) return;
  await db.from("scan_candidates").delete().neq("symbol_a", "__none__");
}

/** Append phase-1 candidates produced by one chunk. */
export async function appendScanCandidates(candidates: ScanCandidate[]): Promise<void> {
  const db = getServiceClient();
  if (!db || candidates.length === 0) return;
  const rows = candidates.map((c) => ({
    symbol_a: c.symbol_a,
    symbol_b: c.symbol_b,
    corr: c.corr,
    beta: c.beta,
    alpha: c.alpha,
    pvalue: c.pValue,
  }));
  const { error } = await db.from("scan_candidates").insert(rows);
  if (error) throw error;
}

/** Read all accumulated candidates for the final BH pass. */
export async function getScanCandidates(): Promise<ScanCandidate[]> {
  const db = getServiceClient() ?? getBrowserClient();
  if (!db) return [];
  const { data, error } = await db.from("scan_candidates").select("*").limit(100000);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, number | string>) => ({
    symbol_a: r.symbol_a as string,
    symbol_b: r.symbol_b as string,
    corr: r.corr as number,
    beta: r.beta as number,
    alpha: r.alpha as number,
    pValue: r.pvalue as number,
  }));
}

export function pairKey(symbolA: string, symbolB: string): string {
  return `${symbolA}__${symbolB}`;
}
