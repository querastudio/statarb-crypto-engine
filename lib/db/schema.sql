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

-- ── Auto-trader positions (open & closed history) ────────────────────────────
create table if not exists public.positions (
  id            uuid primary key default gen_random_uuid(),
  symbol_a      text not null,
  symbol_b      text not null,
  side          text not null,             -- LONG_SPREAD | SHORT_SPREAD
  qty_a         double precision not null,
  qty_b         double precision not null,
  entry_price_a double precision not null,
  entry_price_b double precision not null,
  entry_z       double precision not null,
  beta          double precision not null,
  half_life     double precision not null,
  status        text not null default 'open',  -- open | closed
  mode          text not null,             -- paper | testnet | live
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  exit_price_a  double precision,
  exit_price_b  double precision,
  exit_z        double precision,
  exit_reason   text,
  pnl           double precision
);
create index if not exists positions_status_idx on public.positions (status);

-- ── Blacklisted pairs (cointegration broke) ──────────────────────────────────
create table if not exists public.blacklist (
  pair_key   text primary key,
  created_at timestamptz not null default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS and allow public (anon) reads; writes go through the service-role
-- key which bypasses RLS.
alter table public.pairs     enable row level security;
alter table public.signals   enable row level security;
alter table public.backtests enable row level security;
alter table public.blacklist enable row level security;
alter table public.positions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'positions' and policyname = 'public_read_positions') then
    create policy public_read_positions on public.positions for select using (true);
  end if;
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
end $$;
