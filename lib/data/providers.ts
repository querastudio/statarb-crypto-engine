// Direct REST implementations for Bybit and OKX — no API key, no geo-blocks.
// Binance geo-blocks US IPs (Vercel servers) with HTTP 451, so we use these
// as primary/fallback providers instead.

import type { OHLCV } from "@/lib/types";

// ── Bybit ────────────────────────────────────────────────────────────────────
// V5 kline: max 200 per request, returns newest-first.
// Interval codes: "1","3","5","15","30","60","120","240","360","720","D","W","M"

const BYBIT_INTERVAL: Record<string, string> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
  "1d": "D", "1w": "W", "1M": "M",
};
const BYBIT_MAX = 200;

export async function fetchOHLCVBybit(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<OHLCV[]> {
  const sym = symbol.replace("/", "");
  const interval = BYBIT_INTERVAL[timeframe] ?? "60";
  const allBars: OHLCV[] = [];
  let endTime: number | undefined;
  let remaining = limit;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, BYBIT_MAX);
    const p = new URLSearchParams({
      category: "spot",
      symbol: sym,
      interval,
      limit: String(batchSize),
    });
    if (endTime !== undefined) p.set("end", String(endTime));

    const res = await fetch(`https://api.bybit.com/v5/market/kline?${p}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);

    const json = (await res.json()) as {
      retCode: number;
      retMsg: string;
      result: { list: string[][] };
    };
    if (json.retCode !== 0) throw new Error(`Bybit: ${json.retMsg}`);

    const list = json.result?.list ?? [];
    if (!list.length) break;

    // Reverse from newest-first to oldest-first, then prepend.
    const bars: OHLCV[] = [...list].reverse().map((r) => ({
      timestamp: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));

    allBars.unshift(...bars);
    remaining -= bars.length;
    if (bars.length < batchSize) break;
    endTime = bars[0].timestamp - 1;
  }

  return allBars.slice(-limit);
}

// ── OKX ──────────────────────────────────────────────────────────────────────
// V5 candles: max 300 per request, returns newest-first.
// Symbol format: "ETH-USDT"
// Interval codes: "1m","5m","15m","30m","1H","2H","4H","6H","12H","1D","1W"

const OKX_BAR: Record<string, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6H", "12h": "12H",
  "1d": "1D", "1w": "1W", "1M": "1M",
};
const OKX_MAX = 300;

export async function fetchOHLCVOkx(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<OHLCV[]> {
  const instId = symbol.replace("/", "-");
  const bar = OKX_BAR[timeframe] ?? "1H";
  const allBars: OHLCV[] = [];
  let after: number | undefined;
  let remaining = limit;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, OKX_MAX);
    const p = new URLSearchParams({ instId, bar, limit: String(batchSize) });
    if (after !== undefined) p.set("after", String(after));

    const res = await fetch(`https://www.okx.com/api/v5/market/candles?${p}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);

    const json = (await res.json()) as { code: string; msg: string; data: string[][] };
    if (json.code !== "0") throw new Error(`OKX: ${json.msg}`);

    const list = json.data ?? [];
    if (!list.length) break;

    const bars: OHLCV[] = [...list].reverse().map((r) => ({
      timestamp: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));

    allBars.unshift(...bars);
    remaining -= bars.length;
    if (bars.length < batchSize) break;
    after = bars[0].timestamp;
  }

  return allBars.slice(-limit);
}
