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

// ── Universe discovery via spot tickers (Bybit → OKX fallback) ───────────────

async function universeFromBybit(quote: string, limit: number): Promise<string[]> {
  const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot", {
    headers: { "User-Agent": "statarb-crypto-engine/1.0" },
    signal: AbortSignal.timeout(12_000),
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
    if (/UP$|DOWN$|BULL$|BEAR$|[0-9]+[LS]$/.test(base)) continue;
    const turnover = parseFloat(item.turnover24h);
    if (!isFinite(turnover) || turnover <= 0) continue;
    candidates.push({ symbol: `${base}/${quote}`, turnover });
  }
  candidates.sort((a, b) => b.turnover - a.turnover);
  return candidates.slice(0, limit).map((c) => c.symbol);
}

async function universeFromOkx(quote: string, limit: number): Promise<string[]> {
  const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT", {
    headers: { "User-Agent": "statarb-crypto-engine/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`OKX tickers HTTP ${res.status}`);
  const json = (await res.json()) as {
    code: string;
    data: Array<{ instId: string; volCcy24h: string }>;
  };
  if (json.code !== "0") throw new Error(`OKX tickers code ${json.code}`);
  const suffix = `-${quote}`;
  const candidates: Array<{ symbol: string; turnover: number }> = [];
  for (const item of json.data) {
    if (!item.instId.endsWith(suffix)) continue;
    const base = item.instId.slice(0, item.instId.length - suffix.length);
    if (/UP$|DOWN$|BULL$|BEAR$|[0-9]+[LS]$/.test(base)) continue;
    const turnover = parseFloat(item.volCcy24h);
    if (!isFinite(turnover) || turnover <= 0) continue;
    candidates.push({ symbol: `${base}/${quote}`, turnover });
  }
  candidates.sort((a, b) => b.turnover - a.turnover);
  return candidates.slice(0, limit).map((c) => c.symbol);
}

/**
 * Return the top-N most liquid spot symbols quoted in the configured quote
 * asset, ranked by 24h turnover. Tries Bybit then OKX — both public, no API
 * key, neither geo-blocks Vercel's US servers (unlike Binance/Bybit which
 * may return 403/451 depending on route). Symbols in CCXT unified format.
 */
export async function getLiquidUniverse(limit = config.universeSize): Promise<string[]> {
  const quote = config.quoteAsset;
  const errors: string[] = [];
  for (const [name, fn] of [
    ["Bybit", () => universeFromBybit(quote, limit)],
    ["OKX", () => universeFromOkx(quote, limit)],
  ] as const) {
    try {
      const symbols = await fn();
      if (symbols.length > 0) return symbols;
      errors.push(`${name}: 0 symbols`);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  throw new Error(`Universe fetch failed — ${errors.join(" | ")}`);
}

// ── Aligned price matrix ──────────────────────────────────────────────────────

export interface PriceMatrix {
  symbols: string[];
  timestamps: number[];
  /** closes[symbolIndex][barIndex] aligned on `timestamps`. */
  closes: number[][];
}

/**
 * Fetch and time-align close prices for several symbols.
 * Symbols are processed in batches of BATCH_SIZE to stay within exchange rate
 * limits (30 concurrent requests × paginated pages can trigger 429s on OKX).
 * Symbols that fail to fetch from all providers are silently dropped.
 */
const BATCH_SIZE = 5;

export async function fetchAlignedCloses(
  symbols: string[],
  timeframe = config.timeframe,
  limit = config.lookbackBars,
): Promise<PriceMatrix> {
  const perSymbol = new Map<string, Map<number, number>>();
  const valid: string[] = [];

  // Process in batches to avoid saturating exchange rate limits.
  for (let start = 0; start < symbols.length; start += BATCH_SIZE) {
    const batch = symbols.slice(start, start + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
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
