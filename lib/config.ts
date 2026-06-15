// Central configuration. Reads from environment with sensible, statistically
// defensible defaults. All numeric knobs documented in .env.example.

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function str(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw === undefined || raw === "" ? fallback : raw;
}

export const config = {
  exchange: str("EXCHANGE", "binance"),
  quoteAsset: str("QUOTE_ASSET", "USDT"),
  timeframe: str("TIMEFRAME", "1h"),
  universeSize: num("UNIVERSE_SIZE", 30),
  lookbackBars: num("LOOKBACK_BARS", 720),

  // Pair discovery
  minAbsCorrelation: num("MIN_ABS_CORRELATION", 0.7),
  adfPValueMax: num("ADF_PVALUE_MAX", 0.05),
  halfLifeMinBars: num("HALF_LIFE_MIN_BARS", 1),
  halfLifeMaxBars: num("HALF_LIFE_MAX_BARS", 30),
  hurstMax: num("HURST_MAX", 0.5),

  // Signals
  zscoreWindow: num("ZSCORE_WINDOW", 60),
  entryThreshold: num("ENTRY_THRESHOLD", 2.0),
  exitThreshold: num("EXIT_THRESHOLD", 0.5),
  stopThreshold: num("STOP_THRESHOLD", 3.5),

  // Risk
  riskPerTrade: num("RISK_PER_TRADE", 0.01),
  maxConcurrentPositions: num("MAX_CONCURRENT_POSITIONS", 10),

  // Backtest costs
  feePerLeg: num("FEE_PER_LEG", 0.0004),
  slippage: num("SLIPPAGE", 0.0005),

  // Telegram
  telegramEnabled: str("TELEGRAM_ALERT", "no").toLowerCase() === "yes",
} as const;

export type AppConfig = typeof config;
