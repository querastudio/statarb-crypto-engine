// Exchange data access via CCXT (public market data only — no API key needed).
//
// Provides: liquid-universe discovery (by quote volume) and aligned OHLCV
// close-price matrices for a set of symbols.

import ccxt, { type Exchange } from "ccxt";
import { config } from "@/lib/config";
import type { OHLCV } from "@/lib/types";

let cached: Exchange | null = null;

/** Lazily construct (and cache) the configured CCXT exchange client. */
export function getExchange(): Exchange {
  if (cached) return cached;
  const id = config.exchange as keyof typeof ccxt;
  const ExchangeCtor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[
    id as string
  ];
  if (!ExchangeCtor) {
    throw new Error(`Unknown exchange "${config.exchange}". Check EXCHANGE env var.`);
  }
  cached = new ExchangeCtor({ enableRateLimit: true });
  return cached;
}

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
    // Skip leveraged tokens / obvious derivatives encoded in the base.
    if (/UP$|DOWN$|BULL$|BEAR$|[0-9]+L$|[0-9]+S$/.test(market.base ?? "")) continue;
    const qv = (ticker as { quoteVolume?: number }).quoteVolume ?? 0;
    if (qv > 0) candidates.push({ symbol, quoteVolume: qv });
  }

  candidates.sort((a, b) => b.quoteVolume - a.quoteVolume);
  return candidates.slice(0, limit).map((c) => c.symbol);
}

/** Fetch raw OHLCV for a single symbol. */
export async function fetchOHLCV(
  symbol: string,
  timeframe = config.timeframe,
  limit = config.lookbackBars,
): Promise<OHLCV[]> {
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
 * Fetch and time-align close prices for several symbols. All symbols are
 * fetched in parallel to stay within Vercel serverless time limits. Bars are
 * intersected on timestamp so every series is the same length and aligned.
 * Symbols that fail to fetch are silently dropped.
 */
export async function fetchAlignedCloses(
  symbols: string[],
  timeframe = config.timeframe,
  limit = config.lookbackBars,
): Promise<PriceMatrix> {
  const perSymbol = new Map<string, Map<number, number>>();
  const valid: string[] = [];

  // Fetch all symbols in parallel — critical for staying inside Vercel's 10s
  // Hobby timeout when the caller passes 2–5 symbols.
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

  // Intersect timestamps across all valid symbols.
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
