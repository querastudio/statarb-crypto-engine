# 📈 StatArb Crypto Engine

A statistical-arbitrage (pairs-trading) engine for crypto, built on the
principles that drive successful quant funds: **many small mean-reverting bets
with positive expectancy, tight risk management, and statistically valid
edges** — not single predictions.

- **Edge** comes from *valid cointegration + many signals*, never one forecast.
- Every strategy must **survive backtesting after fees & slippage** to count.
- Focus on **liquid tier-1 assets** (BTC, ETH, SOL, major alts), not memecoins.
- **Adaptive hedge ratios** via a Kalman filter, not static betas.
- Avoids survivorship bias by only trading symbols listed across the backtest
  window (time-aligned price intersection).

> ⚠️ **Research & education only.** StatArb on crypto carries real risk:
> cointegration can break, fees/slippage erode thin edges, and backtests do not
> guarantee live results. Paper-trade first, start small, and understand you can
> lose money.

---

## Architecture

```
statarb-crypto-engine/
├── app/                          # Next.js 14 (App Router) — dashboard + API
│   ├── page.tsx                  # Dashboard: active signals, z-scores, top pairs
│   ├── pairs/page.tsx            # Ranked cointegrated pairs + stats
│   ├── backtest/page.tsx         # Run & visualise a backtest (equity, z-score, trades)
│   └── api/
│       ├── pairs/route.ts        # GET stored pairs
│       ├── signals/route.ts      # GET recent signals
│       ├── backtest/route.ts     # POST run a backtest for one pair
│       └── cron/
│           ├── scan/route.ts     # CRON: pair discovery (every 6h)
│           └── signals/route.ts  # CRON: compute signals + alert (every 15m)
├── lib/
│   ├── data/exchange.ts          # CCXT OHLCV + liquid universe + alignment
│   ├── stats/
│   │   ├── ols.ts                # OLS regression (native, with std errors / t-stats)
│   │   ├── adf.ts                # Augmented Dickey-Fuller unit-root test
│   │   ├── cointegration.ts      # Engle-Granger (OLS + ADF on residuals)
│   │   ├── kalman.ts             # Kalman filter dynamic hedge ratio
│   │   ├── halflife.ts           # Ornstein-Uhlenbeck half-life
│   │   ├── hurst.ts              # Hurst exponent (variance-of-differences)
│   │   └── zscore.ts             # Rolling z-score
│   ├── engine/
│   │   ├── discovery.ts          # Pair discovery pipeline + ranking
│   │   ├── signals.ts            # Signal generation logic
│   │   ├── backtest.ts           # Event-driven backtest with costs + OOS
│   │   └── run.ts                # Cron orchestration (scan / signals)
│   ├── risk/sizing.ts            # Position sizing + structural-break guards
│   ├── db/supabase.ts            # Supabase client + persistence helpers
│   ├── db/schema.sql             # Supabase schema (run once)
│   ├── alert/telegram.ts         # Telegram notifications
│   ├── config.ts                 # Env-driven configuration
│   └── types.ts                  # Shared domain types
├── components/                   # Recharts equity / z-score charts + formatters
├── scripts/seed.ts               # Initial scan / smoke-test
├── tests/                        # Vitest unit tests for all statistics
├── vercel.json                   # Cron schedules + function timeouts
└── .env.example
```

**Stack:** Next.js 14 + TypeScript · CCXT (public price data) · Supabase
(persistence; Vercel is stateless) · Recharts · Vercel Cron. All statistics
(ADF, Engle-Granger, Kalman, half-life, Hurst) are implemented natively in
TypeScript so they run in Vercel serverless functions with no native deps.

---

## Methodology

### 1. Pair discovery (`lib/engine/discovery.ts`)
1. Pull the **top-N most liquid** `*/USDT` spot symbols by 24h quote volume.
2. Time-align close prices (intersection of timestamps → no look-ahead / no
   survivorship gaps).
3. For each pair:
   - **Correlation pre-filter:** drop `|Pearson| < 0.7` (saves compute).
   - **Engle-Granger:** OLS `A = α + β·B + resid`, then **ADF** on the
     residuals; cointegrated if ADF p-value `< 0.05`.
   - **Half-life** (Ornstein-Uhlenbeck): keep only `1 ≤ half-life ≤ 30` bars
     (too fast → fees dominate; too slow → capital trapped).
   - **Hurst < 0.5** confirms mean reversion.
4. Rank by a composite score (low ADF p-value + ideal half-life + low Hurst).

### 2. Signal engine (`lib/engine/signals.ts`)
- Spread `= price_A − β·price_B`, with **β updated every bar by a Kalman
  filter** (state-space model).
- Rolling **z-score** `z = (spread − mean) / std` (default window 60).
- Rules:
  - `z > +2.0` → **SHORT spread** (short A, long β·B)
  - `z < −2.0` → **LONG spread** (long A, short β·B)
  - `|z| < 0.5` → **CLOSE**
  - `|z| > 3.5` → **STOP** (likely structural break)

### 3. Risk management (`lib/risk/sizing.ts`)
- Position sized so hitting the stop loses ~`RISK_PER_TRADE` (default 1%) of
  equity.
- Max concurrent positions (default 10) → diversify across uncorrelated pairs.
- **Structural-break guard:** re-test cointegration; if a pair stops
  cointegrating, close & blacklist.
- Stops are **z-score based** *and* **time based** (close after `2× half-life`
  without convergence).

### 4. Backtest engine (`lib/engine/backtest.ts`)
- Event-driven, with realistic costs: **taker fee per leg** (default 0.04%) +
  **slippage** (default 0.05%), charged on entry and exit of both legs.
- Metrics: Sharpe, Sortino, max drawdown, win rate, profit factor, avg trade
  duration, total trades, equity curve.
- **Out-of-sample split** (`trainFraction`, default 0.7) reported separately to
  expose overfitting.
- Shows **before-cost vs after-cost** so the surviving edge is explicit.

---

## Reading the metrics

| Metric | What it means | Rule of thumb |
| --- | --- | --- |
| **Sharpe** | Risk-adjusted return (annualised) | > 1 interesting, > 2 strong — *after costs* |
| **Sortino** | Like Sharpe but penalises only downside | Higher is better |
| **Max drawdown** | Worst peak-to-trough equity drop | Smaller is better |
| **Win rate** | Fraction of profitable trades | Mean-reversion is often 55–70% |
| **Profit factor** | Gross profit ÷ gross loss | > 1 profitable, > 1.5 healthy |
| **Total return (net vs gross)** | After-cost vs before-cost | The *gap* is your cost drag — watch it |
| **OOS metrics** | Same metrics on held-out test data | Should resemble in-sample; if it collapses → overfit |

If after-cost OOS Sharpe/return collapses versus before-cost in-sample, the
"edge" was mostly fees and curve-fitting. Trust the **OOS, after-cost** numbers.

---

## Setup

### Prerequisites
- Node.js 18+ and npm
- A Supabase project (URL + anon key + service-role key)
- *(optional)* A Telegram bot token + chat ID

### Local development
```bash
npm install
cp .env.example .env.local       # then fill in the values
npm test                         # run the statistics unit tests (all should pass)
npm run dev                      # http://localhost:3000
```

Run an ad-hoc scan / smoke-test against the live exchange:
```bash
node --env-file=.env.local --import tsx scripts/seed.ts
# or simply: npx tsx scripts/seed.ts   (uses process env / defaults)
```

> **Network note:** CCXT calls the exchange's public REST API
> (`api.binance.com`). In restricted/sandboxed environments you must allowlist
> that host for outbound egress. Vercel allows it by default.

### Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. In the **SQL editor**, run [`lib/db/schema.sql`](lib/db/schema.sql) to create
   the `pairs`, `signals`, `backtests`, and `blacklist` tables (RLS enabled,
   public reads; writes use the service role).
3. Copy the project URL, the **anon** key, and the **service-role** key into
   your env vars.

### Telegram (optional)
1. Create a bot via [@BotFather](https://t.me/BotFather) → get the token.
2. Get your chat ID (e.g. message [@userinfobot](https://t.me/userinfobot)).
3. Set `TELEGRAM_ALERT=yes`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

---

## Deploy to Vercel

This repo is built to deploy as-is.

1. Push to GitHub (this repo).
2. In Vercel, **Import Project** → select the repo.
3. Add the **Environment Variables** below (Project → Settings → Environment
   Variables).
4. Deploy. The cron jobs in [`vercel.json`](vercel.json) register automatically:
   - `/api/cron/scan` — every 6 hours (pair discovery)
   - `/api/cron/signals` — every 15 minutes (signals + alerts)

> Cron + the backtest function are configured for a 60s `maxDuration` (Vercel
> **Pro**). On **Hobby** (10s limit), reduce `UNIVERSE_SIZE` and/or call
> `/api/cron/scan?maxCombos=N` to chunk the work, since pair discovery is
> O(N²) in the universe size.

### Environment variables to set in Vercel

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key (dashboard reads) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **Server only** — cron writes |
| `CRON_SECRET` | ✅ (prod) | `openssl rand -hex 32`; protects cron routes |
| `EXCHANGE` | – | default `binance` |
| `QUOTE_ASSET` | – | default `USDT` |
| `TIMEFRAME` | – | default `1h` |
| `UNIVERSE_SIZE` | – | default `30` |
| `LOOKBACK_BARS` | – | default `720` |
| `TELEGRAM_ALERT` | – | `yes` to enable |
| `TELEGRAM_BOT_TOKEN` | if alerts | |
| `TELEGRAM_CHAT_ID` | if alerts | |
| `MIN_ABS_CORRELATION`, `ADF_PVALUE_MAX`, `HALF_LIFE_MIN_BARS`, `HALF_LIFE_MAX_BARS`, `HURST_MAX` | – | discovery thresholds |
| `ZSCORE_WINDOW`, `ENTRY_THRESHOLD`, `EXIT_THRESHOLD`, `STOP_THRESHOLD` | – | signal thresholds |
| `RISK_PER_TRADE`, `MAX_CONCURRENT_POSITIONS` | – | risk |
| `FEE_PER_LEG`, `SLIPPAGE` | – | backtest costs |

See [`.env.example`](.env.example) for the full list with defaults.

---

## Tests

All statistical functions are unit-tested against synthetic data with known
properties (a seeded PRNG keeps them deterministic):

```bash
npm test
```

Key correctness guarantees:
- **ADF** rejects the unit root for stationary AR(1) series and *fails to
  reject* for random walks.
- **Engle-Granger** detects synthetic cointegrated pairs (and recovers the
  hedge ratio) while rejecting independent random walks.
- **Kalman filter** converges to a constant true hedge ratio and adapts to a
  mid-series regime change.
- **Half-life / Hurst / z-score / OLS** match analytic expectations.

---

## Security note

This scaffold pins Next.js to a patched `14.2.x`. `npm audit` may still report
moderate advisories that are only fixable by upgrading to Next.js 16 (a major,
breaking change). They concern features this app does **not** use (image
optimization, i18n middleware, websocket upgrades). Upgrade to the Next.js 16
line when you're ready to migrate.

---

## Disclaimer

This tool is for **research and education**. Statistical arbitrage on crypto has
real risks: cointegration relationships break, fees and slippage consume thin
edges, and backtest performance does **not** guarantee live results. Always
paper-trade first, start with small capital, and understand that you can lose
money. Nothing here is financial advice.
