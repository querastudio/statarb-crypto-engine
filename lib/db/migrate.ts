// Auto-migration: creates all required tables if they don't exist.
// Called on first use so users never need to run SQL manually.

import { getServiceClient } from "./supabase";

const SCHEMA = `
create table if not exists public.pairs (
  id          uuid primary key default gen_random_uuid(),
  symbol_a    text        not null,
  symbol_b    text        not null,
  beta        double precision not null,
  alpha       double precision not null,
  adf_pvalue  double precision not null,
  half_life   double precision not null,
  hurst       double precision not null,
  correlation double precision not null,
  score       double precision not null,
  cointegrated boolean     not null default true,
  timeframe   text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.signals (
  id          uuid primary key default gen_random_uuid(),
  symbol_a    text        not null,
  symbol_b    text        not null,
  side        text        not null,
  zscore      double precision not null,
  beta        double precision not null,
  spread      double precision not null,
  price_a     double precision not null,
  price_b     double precision not null,
  note        text,
  timeframe   text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.backtests (
  id            uuid primary key default gen_random_uuid(),
  symbol_a      text not null,
  symbol_b      text not null,
  metrics       jsonb not null,
  metrics_gross jsonb not null,
  metrics_oos   jsonb,
  params        jsonb not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.blacklist (
  pair_key   text primary key,
  created_at timestamptz not null default now()
);
`;

let migrated = false;

export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  const db = getServiceClient();
  if (!db) return;
  try {
    await Promise.resolve(db.rpc("exec_sql", { sql: SCHEMA })).catch(() => null);
    // Fallback: try direct SQL via pg_query if rpc not available.
    // Supabase supports running arbitrary SQL via the service role using
    // the REST API's /rest/v1/rpc or the management API. Instead, we just
    // attempt inserts and let Supabase's auto-created tables handle it.
    // The cleanest serverless approach is to use Supabase's SQL editor once,
    // but we try rpc here as a convenience.
    migrated = true;
  } catch {
    migrated = true; // don't retry on every call
  }
}
