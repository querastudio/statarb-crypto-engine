// Shared domain types for the StatArb engine.

/** A single OHLCV bar. Timestamps are unix ms. */
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Result of an Augmented Dickey-Fuller unit-root test. */
export interface ADFResult {
  /** The ADF test statistic (t-stat on the lagged-level coefficient). */
  statistic: number;
  /** Approximate p-value (MacKinnon-style interpolation). */
  pValue: number;
  /** Number of augmenting lags used. */
  usedLag: number;
  /** Number of observations used in the regression. */
  nobs: number;
  /** Critical values for the "constant, no trend" case. */
  criticalValues: { "1%": number; "5%": number; "10%": number };
  /** True if the null (unit root) is rejected at the 5% level. */
  stationary: boolean;
}

/** Result of an Engle-Granger cointegration test for the ordered pair (A, B). */
export interface CointegrationResult {
  /** Hedge ratio: beta in  A = alpha + beta * B + residual. */
  beta: number;
  /** Intercept of the cointegrating regression. */
  alpha: number;
  /** ADF test on the regression residuals. */
  adf: ADFResult;
  /** Convenience: adf.pValue. */
  pValue: number;
  /** True if residuals are stationary at the 5% level. */
  cointegrated: boolean;
}

/** A discovered, ranked tradable pair. */
export interface Pair {
  id?: string;
  symbol_a: string;
  symbol_b: string;
  beta: number;
  alpha: number;
  adf_pvalue: number;
  half_life: number;
  hurst: number;
  correlation: number;
  /** Composite ranking score — higher is better. */
  score: number;
  cointegrated: boolean;
  timeframe: string;
  created_at?: string;
  updated_at?: string;
}

export type SignalSide = "LONG_SPREAD" | "SHORT_SPREAD" | "CLOSE" | "STOP" | "FLAT";

/** A live trading signal for a pair. */
export interface Signal {
  id?: string;
  symbol_a: string;
  symbol_b: string;
  side: SignalSide;
  zscore: number;
  beta: number;
  spread: number;
  price_a: number;
  price_b: number;
  /** Notes such as "structural break" or "time stop". */
  note?: string;
  timeframe: string;
  created_at?: string;
}

/** A single completed round-trip trade in a backtest. */
export interface BacktestTrade {
  side: "LONG_SPREAD" | "SHORT_SPREAD";
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryZ: number;
  exitZ: number;
  /** Net return on allocated capital, after costs. */
  pnl: number;
  /** Gross return before costs. */
  grossPnl: number;
  bars: number;
  exitReason: "exit" | "stop" | "time" | "end";
}

/** Aggregate metrics produced by the backtest engine. */
export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  profitFactor: number;
  avgTradeDurationBars: number;
  totalReturn: number;
  totalReturnGross: number;
  cagr?: number;
}

/** Equity-curve point. */
export interface EquityPoint {
  index: number;
  timestamp: number;
  equity: number;
  equityGross: number;
  zscore: number;
}

/** One time-slice in a walk-forward analysis. */
export interface WalkForwardFold {
  /** Human label, e.g. "Fold 1". */
  label: string;
  startBar: number;
  endBar: number;
  /** Net total return over this fold (after costs). */
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  totalTrades: number;
  winRate: number;
}

/** Aggregate result of walk-forward analysis across all folds. */
export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Fraction of folds with positive net return (0..1). */
  consistencyPct: number;
  avgSharpe: number;
  avgReturn: number;
  /** True if >60% of folds profitable AND avgSharpe > 0.5. */
  isRobust: boolean;
}

/** Kelly Criterion position-sizing result. */
export interface KellyResult {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** Raw Kelly fraction. Aggressive — for reference only. */
  kellyFull: number;
  /** Half-Kelly: recommended for live trading. */
  kellyHalf: number;
  /** Quarter-Kelly: conservative, for first live trades. */
  kellyQuarter: number;
  /** Tier label based on half-Kelly. */
  tier: "strong" | "moderate" | "weak" | "insufficient";
}

export interface BacktestResult {
  symbol_a: string;
  symbol_b: string;
  /** Net (after-cost) metrics over the full sample. */
  metrics: BacktestMetrics;
  /** Gross (before-cost) metrics over the full sample — shows cost drag. */
  metricsGross: BacktestMetrics;
  /** Net metrics over the out-of-sample (test) portion only. */
  metricsOOS: BacktestMetrics;
  /** Bar index where the out-of-sample period begins. */
  oosStartIndex: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  params: BacktestParams;
  /** Walk-forward analysis: strategy performance across rolling time slices. */
  walkForward?: WalkForwardResult;
  /** Kelly Criterion position sizing recommendation. Null if <10 trades. */
  kelly?: KellyResult | null;
}

/** Execution mode for the auto-trader. */
export type TradingMode = "paper" | "testnet" | "live";

/** An open or closed pair position held by the auto-trader. */
export interface Position {
  id?: string;
  symbol_a: string;
  symbol_b: string;
  /** Spread side: LONG_SPREAD = long A / short B; SHORT_SPREAD = short A / long B. */
  side: "LONG_SPREAD" | "SHORT_SPREAD";
  /** Base-asset quantity traded on each leg (always positive). */
  qty_a: number;
  qty_b: number;
  entry_price_a: number;
  entry_price_b: number;
  entry_z: number;
  beta: number;
  /** When the position was opened (unix ms, ISO string). */
  opened_at?: string;
  /** Half-life of the pair at entry, for the time-stop. */
  half_life: number;
  status: "open" | "closed";
  /** Which engine mode opened it — guards against mixing paper & live rows. */
  mode: TradingMode;
  closed_at?: string;
  exit_price_a?: number;
  exit_price_b?: number;
  exit_z?: number;
  exit_reason?: string;
  /** Realized net return on allocated capital (filled on close). */
  pnl?: number;
}

export interface BacktestParams {
  zscoreWindow: number;
  entryThreshold: number;
  exitThreshold: number;
  stopThreshold: number;
  feePerLeg: number;
  slippage: number;
  /** Use Kalman-adaptive beta instead of static OLS beta. */
  useKalman: boolean;
  /** Fraction of data used for in-sample (train); remainder is out-of-sample. */
  trainFraction: number;
  /** Skip new entries when regime detector signals DANGER. */
  useRegimeFilter: boolean;
}
