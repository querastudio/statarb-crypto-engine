// Exchange data access.
//
// OHLCV price data uses Bybit or OKX public REST APIs directly — no API key,
// and neither geo-blocks Vercel's US-based servers. Binance returns HTTP 451
// (geo-block) from Vercel, so it is NOT used as a primary provider.
//
// CCXT is kept only for getLiquidUniverse (universe scan cron) which needs
// market metadata and runs infrequently.

import ccxt, { type Exchange } from "ccxt";
import { config } from "@/lib/config";
import type { OHLCV } from "@/lib/types";
import { fetchOHLCVBybit, fetchOHLCVOkx } from "./providers";

// ── Multi-provider OHLCV fetch ────────────────────────────────────────────────

// Providers tried in order. First success wins.
type Provider = { name: string; fetch: (s: string, tf: string, l: number) => Promise<OHLCV[]> };

const PROVIDERS: Provider[] = [
  { name: "Bybit", fetch: fetchOHLCVBybit },
  { name: "OKX", fetch: fetchOHLCVOkx },
];

/** Fetch raw OHLCV for a single symbol, trying providers until one succeeds. */
export async function fetchOHLCV(
  symbol: string,
  timeframe = config.timeframe,
  limit = config.lookbackBars,
): Promise<OHLCV[]> {
  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    try {
      const bars = await provider.fetch(symbol, timeframe, limit);
      if (bars.length > 0) return bars;
      errors.push(`${provider.name}: returned 0 bars`);
    } catch (e) {
      errors.push(`${provider.name}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  throw new Error(`All providers failed for ${symbol}: ${errors.join(" | ")}`);
}

// ── CCXT (universe scan only) ─────────────────────────────────────────────────

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

/**
 * Return the top-N most liquid spot symbols quoted in the configured quote
 * asset, ranked by 24h quote volume. Symbols are CCXT unified (e.g. "BTC/USDT").
 * Used by the scan cron only.
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

// ── Aligned price matrix ──────────────────────────────────────────────────────

export interface PriceMatrix {
  symbols: string[];
  timestamps: number[];
  /** closes[symbolIndex][barIndex] aligned on `timestamps`. */
  closes: number[][];
}

/**
 * Fetch and time-align close prices for several symbols in parallel.
 * Symbols that fail to fetch from ALL providers are silently dropped.
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
