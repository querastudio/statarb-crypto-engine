// Exchange data access.
//
// For OHLCV price data we use the Binance public REST API directly via native
// fetch() — no API key, no CCXT overhead, reliable in Vercel serverless.
// CCXT is kept only for the universe scan (getLiquidUniverse) which needs
// market metadata and runs less frequently on a cron.

import ccxt, { type Exchange } from "ccxt";
import { config } from "@/lib/config";
import type { OHLCV } from "@/lib/types";

// ── Binance direct REST (primary, used for backtest & signal routes) ──────────

const BINANCE_BASE = "https://api.binance.com";

/** Convert CCXT unified symbol "BTC/USDT" → Binance REST symbol "BTCUSDT". */
function toBinanceSymbol(ccxtSymbol: string): string {
  return ccxtSymbol.replace("/", "");
}

/**
 * Fetch OHLCV from Binance public klines endpoint using native fetch().
 * Timeframe must be a valid Binance interval string: 1m,5m,15m,1h,4h,1d …
 */
async function fetchOHLCVBinance(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<OHLCV[]> {
  const bSymbol = toBinanceSymbol(symbol);
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${bSymbol}&interval=${timeframe}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Bypass Next.js data cache — we always want fresh candles.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance ${res.status} for ${symbol}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Array<[number, string, string, string, string, string, ...unknown[]]>;
  return data.map((r) => ({
    timestamp: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

// ── CCXT (used only for universe scan) ───────────────────────────────────────

let cachedExchange: Exchange | null = null;

function getExchange(): Exchange {
  if (cachedExchange) return cachedExchange;
  const id = config.exchange as string;
  const ExchangeCtor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[id];
  if (!ExchangeCtor) {
    throw new Error(`Unknown exchange "${config.exchange}". Check EXCHANGE env var.`);
  }
  cachedExchange = new ExchangeCtor({ enableRateLimit: true });
  return cachedExchange;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the top-N most liquid spot symbols quoted in the configured quote
 * asset, ranked by 24h quote volume. Symbols are CCXT unified (e.g. "BTC/USDT").
 */
export async function getLiquidUniverse(limit = config.universeSize): Promise<string[]> {
  const ex = getExchange();
  await ex.loadMarkets();
  const tickers = await ex.fetchTickers();

  const quote = config.quoteAsset;
  const candidates: Array<{ symbol: string; quoteVolume: number }> = [];

  for (const [symbol, ticker] of Object.entries(tickers)) {
    const market = ex.markets[symbol];
    if (!market || !market.spot || market.active === false) continue;
    if (market.quote !== quote) continue;
    if (/UP$|DOWN$|BULL$|BEAR$|[0-9]+L$|[0-9]+S$/.test(market.base ?? "")) continue;
    const qv = (ticker as { quoteVolume?: number }).quoteVolume ?? 0;
    if (qv > 0) candidates.push({ symbol, quoteVolume: qv });
  }

  candidates.sort((a, b) => b.quoteVolume - a.quoteVolume);
  return candidates.slice(0, limit).map((c) => c.symbol);
}

/** Fetch raw OHLCV for a single symbol (Binance direct → CCXT fallback). */
export async function fetchOHLCV(
  symbol: string,
  timeframe = config.timeframe,
  limit = config.lookbackBars,
): Promise<OHLCV[]> {
  if (config.exchange === "binance") {
    return fetchOHLCVBinance(symbol, timeframe, limit);
  }
  // Non-Binance exchanges: use CCXT.
  const ex = getExchange();
  const raw = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
  return raw.map((r) => ({
    timestamp: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

export interface PriceMatrix {
  symbols: string[];
  timestamps: number[];
  /** closes[symbolIndex][barIndex] aligned on `timestamps`. */
  closes: number[][];
}

/**
 * Fetch and time-align close prices for several symbols. All symbols fetched
 * in parallel via native fetch → stays well within Vercel Hobby 10s timeout.
 * Symbols that fail to fetch are silently dropped.
 */
export async function fetchAlignedCloses(
  symbols: string[],
  timeframe = config.timeframe,
  limit = config.lookbackBars,
): Promise<PriceMatrix> {
  const perSymbol = new Map<string, Map<number, number>>();
  const valid: string[] = [];

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const bars = await fetchOHLCV(symbol, timeframe, limit);
      return { symbol, bars };
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") continue;
    const { symbol, bars } = result.value;
    if (bars.length < Math.min(40, Math.floor(limit / 4))) continue;
    const m = new Map<number, number>();
    for (const b of bars) m.set(b.timestamp, b.close);
    perSymbol.set(symbol, m);
    valid.push(symbol);
  }

  if (valid.length === 0) {
    return { symbols: [], timestamps: [], closes: [] };
  }

  let common: number[] | null = null;
  for (const symbol of valid) {
    const ts = Array.from(perSymbol.get(symbol)!.keys());
    common = common === null ? ts : common.filter((t) => perSymbol.get(symbol)!.has(t));
  }
  const timestamps = (common ?? []).sort((a, b) => a - b);

  const closes = valid.map((symbol) => {
    const m = perSymbol.get(symbol)!;
    return timestamps.map((t) => m.get(t)!);
  });

  return { symbols: valid, timestamps, closes };
}
