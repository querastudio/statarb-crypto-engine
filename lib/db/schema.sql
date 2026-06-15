-- StatArb Crypto Engine — Supabase schema
-- Run this in the Supabase SQL editor (or via the CLI) to provision tables.

-- ── Discovered, ranked pairs (overwritten each scan) ─────────────────────────
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
create index if not exists pairs_score_idx on public.pairs (score desc);

-- ── Generated signals (append-only history) ──────────────────────────────────
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
create index if not exists signals_created_idx on public.signals (created_at desc);

-- ── Backtest results ─────────────────────────────────────────────────────────
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

-- ── Blacklisted pairs (cointegration broke) ──────────────────────────────────
create table if not exists public.blacklist (
  pair_key   text primary key,
  created_at timestamptz not null default now()
);

-- ── Chunked-scan state ────────────────────────────────────────────────────────
-- Large universes (100+ coins) exceed Vercel's 60s function limit in a single
-- pass, so discovery is split across several chunk runs. The session row pins
-- the exact symbol ordering so every chunk enumerates the same combinations,
-- and candidates accumulate here until the final chunk runs Benjamini-Hochberg
-- over the COMPLETE set (BH is only valid across all p-values at once).
create table if not exists public.scan_session (
  id         integer primary key default 1,
  symbols    jsonb       not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scan_candidates (
  id         bigint generated always as identity primary key,
  symbol_a   text             not null,
  symbol_b   text             not null,
  corr       double precision not null,
  beta       double precision not null,
  alpha      double precision not null,
  pvalue     double precision not null,
  created_at timestamptz      not null default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS and allow public (anon) reads; writes go through the service-role
-- key which bypasses RLS.
alter table public.pairs           enable row level security;
alter table public.signals         enable row level security;
alter table public.backtests       enable row level security;
alter table public.blacklist       enable row level security;
alter table public.scan_session    enable row level security;
alter table public.scan_candidates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'pairs' and policyname = 'public_read_pairs') then
    create policy public_read_pairs on public.pairs for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'signals' and policyname = 'public_read_signals') then
    create policy public_read_signals on public.signals for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'backtests' and policyname = 'public_read_backtests') then
    create policy public_read_backtests on public.backtests for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'blacklist' and policyname = 'public_read_blacklist') then
    create policy public_read_blacklist on public.blacklist for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scan_session' and policyname = 'public_read_scan_session') then
    create policy public_read_scan_session on public.scan_session for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scan_candidates' and policyname = 'public_read_scan_candidates') then
    create policy public_read_scan_candidates on public.scan_candidates for select using (true);
  end if;
end $$;
