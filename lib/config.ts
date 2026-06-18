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
  halfLifeMaxBars: num("HALF_LIFE_MAX_BARS", 120), // 120 h = 5 days; 30 was too tight
  hurstMax: num("HURST_MAX", 0.5),
  // Benjamini-Hochberg FDR: at most this fraction of reported pairs are false
  // positives. 0.10 = 10% FDR. Lower = stricter (fewer but cleaner pairs).
  fdrAlpha: num("FDR_ALPHA", 0.10),

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

  // ── Auto-trading (Bybit USDT Perpetuals) ───────────────────────────────────
  // Master kill switch. Default OFF — must be explicitly enabled.
  tradingEnabled: str("TRADING_ENABLED", "no").toLowerCase() === "yes",
  // paper = log intended orders only (no API); testnet = real orders on Bybit
  // testnet; live = real money. Default paper for safety.
  tradingMode: str("TRADING_MODE", "paper").toLowerCase() as "paper" | "testnet" | "live",
  // Equity used to size positions in paper mode (no real wallet to query).
  paperEquity: num("PAPER_EQUITY", 1000),
  // Leverage per leg. Kept low to bound liquidation risk (1 = no leverage).
  leverage: num("TRADING_LEVERAGE", 1),
  // Cap each trade's gross notional to this fraction of equity (both legs summed),
  // so a tiny stop-distance can't blow sizing up into excessive leverage.
  maxNotionalFraction: num("MAX_NOTIONAL_FRACTION", 0.5),
  // Minimum order value (USDT) per leg; below this Bybit rejects the order.
  minOrderNotional: num("MIN_ORDER_NOTIONAL", 5),
  // Skip opening NEW positions when the regime detector flags DANGER (volatility
  // expansion / trending spread / structural break). Existing positions are
  // still managed normally. Default on — safety first.
  regimeFilterLive: str("REGIME_FILTER_LIVE", "yes").toLowerCase() === "yes",
  // Re-test cointegration on OPEN positions each cycle; close if the pair has
  // structurally broken (current ADF p-value > adfPValueMax). Default on.
  adfRetestLive: str("ADF_RETEST_LIVE", "yes").toLowerCase() === "yes",
  // Quality gate for NEW entries: backtest the candidate on the live window and
  // require net Sharpe ≥ this. Blocks pairs that have been losing recently.
  // 0 = "must be non-negative". Set negative (e.g. -99) to disable the gate.
  minEntrySharpe: num("MIN_ENTRY_SHARPE", 0),
  // Daily-loss circuit breaker: when (realized today + open unrealized) ≤
  // -maxDailyLossFraction × equity, stop opening NEW positions for the rest of
  // the UTC day. Existing positions are still managed. 0 disables the breaker.
  maxDailyLossFraction: num("MAX_DAILY_LOSS_FRACTION", 0.05),
} as const;

export type AppConfig = typeof config;
