// Exchange data access.
//
// OHLCV price data and the liquid universe both use Bybit or OKX public REST
// APIs directly — no API key, and neither geo-blocks Vercel's US-based servers.
// Binance returns HTTP 451 (geo-block) from Vercel, so it is NOT used.

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

// ── Universe discovery via Bybit spot tickers ─────────────────────────────────

/**
 * Return the top-N most liquid spot symbols quoted in the configured quote
 * asset, ranked by 24h turnover. Uses Bybit's public spot tickers endpoint —
 * no API key required, no geo-block from Vercel. Symbols are CCXT-unified
 * format (e.g. "BTC/USDT").
 */
export async function getLiquidUniverse(limit = config.universeSize): Promise<string[]> {
  const quote = config.quoteAsset;
  const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Bybit tickers HTTP ${res.status}`);
  const json = (await res.json()) as {
    retCode: number;
    result: { list: Array<{ symbol: string; turnover24h: string }> };
  };
  if (json.retCode !== 0) throw new Error(`Bybit tickers retCode ${json.retCode}`);

  const candidates: Array<{ symbol: string; turnover: number }> = [];
  for (const item of json.result.list) {
    if (!item.symbol.endsWith(quote)) continue;
    const base = item.symbol.slice(0, item.symbol.length - quote.length);
    // Skip leveraged/inverse tokens
    if (/UP$|DOWN$|BULL$|BEAR$|[0-9]+[LS]$/.test(base)) continue;
    const turnover = parseFloat(item.turnover24h);
    if (!isFinite(turnover) || turnover <= 0) continue;
    candidates.push({ symbol: `${base}/${quote}`, turnover });
  }

  candidates.sort((a, b) => b.turnover - a.turnover);
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
