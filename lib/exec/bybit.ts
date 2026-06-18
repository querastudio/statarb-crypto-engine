// Bybit V5 trading client for USDT Perpetual Futures (category=linear).
//
// Only what the executor needs: instrument precision, account equity, leverage,
// and market orders. Public endpoints (instruments-info) need no auth; private
// endpoints are signed with HMAC-SHA256 per Bybit V5 spec.
//
// Keys are read from the environment ONLY — never hard-coded, never logged:
//   BYBIT_API_KEY, BYBIT_API_SECRET, BYBIT_TESTNET (yes/no)
//
// Signing (V5):
//   sign = HMAC_SHA256( timestamp + apiKey + recvWindow + payload , secret )
//   payload = queryString (GET) or raw JSON body (POST)

import crypto from "node:crypto";

const RECV_WINDOW = "5000";

export type OrderSide = "Buy" | "Sell";

export interface BybitCreds {
  baseUrl: string;
  key: string;
  secret: string;
  testnet: boolean;
}

/** Resolve base URL + credentials from env. Throws if keys are missing. */
export function bybitCreds(): BybitCreds {
  const testnet = (process.env.BYBIT_TESTNET ?? "yes").toLowerCase() === "yes";
  const key = process.env.BYBIT_API_KEY ?? "";
  const secret = process.env.BYBIT_API_SECRET ?? "";
  if (!key || !secret) {
    throw new Error("BYBIT_API_KEY / BYBIT_API_SECRET not configured");
  }
  return {
    baseUrl: testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com",
    key,
    secret,
    testnet,
  };
}

/** Public base URL — instruments-info works on either env; use mainnet for data. */
function publicBaseUrl(): string {
  const testnet = (process.env.BYBIT_TESTNET ?? "yes").toLowerCase() === "yes";
  return testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com";
}

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

function sign(secret: string, timestamp: string, key: string, payload: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(timestamp + key + RECV_WINDOW + payload)
    .digest("hex");
}

async function signedGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const c = bybitCreds();
  const qs = new URLSearchParams(params).toString();
  const ts = String(Date.now());
  const headers = {
    "X-BAPI-API-KEY": c.key,
    "X-BAPI-TIMESTAMP": ts,
    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    "X-BAPI-SIGN": sign(c.secret, ts, c.key, qs),
  };
  const res = await fetch(`${c.baseUrl}${path}?${qs}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json()) as BybitEnvelope<T>;
  if (json.retCode !== 0) throw new Error(`Bybit ${path}: ${json.retMsg} (${json.retCode})`);
  return json.result;
}

async function signedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const c = bybitCreds();
  const payload = JSON.stringify(body);
  const ts = String(Date.now());
  const headers = {
    "X-BAPI-API-KEY": c.key,
    "X-BAPI-TIMESTAMP": ts,
    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    "X-BAPI-SIGN": sign(c.secret, ts, c.key, payload),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${c.baseUrl}${path}`, {
    method: "POST",
    headers,
    body: payload,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json()) as BybitEnvelope<T>;
  if (json.retCode !== 0) throw new Error(`Bybit ${path}: ${json.retMsg} (${json.retCode})`);
  return json.result;
}

// ── Symbol formatting ─────────────────────────────────────────────────────────

/** "BTC/USDT" → "BTCUSDT" (Bybit linear instrument id). */
export function toBybitSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

// ── Instrument precision (public, no auth) ────────────────────────────────────

export interface InstrumentInfo {
  symbol: string;
  qtyStep: number;
  minQty: number;
  /** Minimum order value in quote (USDT). 0 if unspecified. */
  minNotional: number;
}

const instrumentCache = new Map<string, InstrumentInfo>();

export async function getInstrumentInfo(symbol: string): Promise<InstrumentInfo | null> {
  const sym = toBybitSymbol(symbol);
  const cached = instrumentCache.get(sym);
  if (cached) return cached;

  const url = `${publicBaseUrl()}/v5/market/instruments-info?category=linear&symbol=${sym}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const json = (await res.json()) as BybitEnvelope<{
    list: Array<{
      symbol: string;
      lotSizeFilter: { qtyStep: string; minOrderQty: string; minNotionalValue?: string };
    }>;
  }>;
  if (json.retCode !== 0) return null;
  const item = json.result.list?.[0];
  if (!item) return null;

  const info: InstrumentInfo = {
    symbol: sym,
    qtyStep: Number(item.lotSizeFilter.qtyStep) || 0,
    minQty: Number(item.lotSizeFilter.minOrderQty) || 0,
    minNotional: Number(item.lotSizeFilter.minNotionalValue ?? "0") || 0,
  };
  instrumentCache.set(sym, info);
  return info;
}

/** Round a quantity DOWN to the instrument's lot step. */
export function roundQty(qty: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return qty;
  const rounded = Math.floor(qty / step) * step;
  // Avoid binary-float dust like 0.30000000000000004.
  const decimals = (step.toString().split(".")[1] ?? "").length;
  return Number(rounded.toFixed(decimals));
}

// ── Account equity (signed) ───────────────────────────────────────────────────

/** Total USDT equity of the UNIFIED trading account. */
export async function getEquity(): Promise<number> {
  const result = await signedGet<{
    list: Array<{ totalEquity: string; coin: Array<{ coin: string; equity: string }> }>;
  }>("/v5/account/wallet-balance", { accountType: "UNIFIED" });
  const acct = result.list?.[0];
  if (!acct) return 0;
  const total = Number(acct.totalEquity);
  if (Number.isFinite(total) && total > 0) return total;
  // Fallback: sum USDT coin equity.
  const usdt = acct.coin?.find((c) => c.coin === "USDT");
  return usdt ? Number(usdt.equity) || 0 : 0;
}

// ── Leverage (signed) ─────────────────────────────────────────────────────────

/** Set leverage for a symbol. Bybit returns 110043 when unchanged — that's fine. */
export async function setLeverage(symbol: string, leverage: number): Promise<void> {
  const sym = toBybitSymbol(symbol);
  const lev = String(leverage);
  try {
    await signedPost("/v5/position/set-leverage", {
      category: "linear",
      symbol: sym,
      buyLeverage: lev,
      sellLeverage: lev,
    });
  } catch (e) {
    // 110043 = "leverage not modified" — already at this value.
    if (!(e as Error).message.includes("110043")) throw e;
  }
}

// ── Market orders (signed) ────────────────────────────────────────────────────

export interface OrderResult {
  orderId: string;
  orderLinkId: string;
}

/** Place a market order on a linear perpetual. */
export async function placeMarketOrder(opts: {
  symbol: string;
  side: OrderSide;
  qty: number;
  reduceOnly?: boolean;
  orderLinkId?: string;
}): Promise<OrderResult> {
  const sym = toBybitSymbol(opts.symbol);
  return signedPost<OrderResult>("/v5/order/create", {
    category: "linear",
    symbol: sym,
    side: opts.side,
    orderType: "Market",
    qty: String(opts.qty),
    reduceOnly: opts.reduceOnly ?? false,
    ...(opts.orderLinkId ? { orderLinkId: opts.orderLinkId } : {}),
  });
}

// ── Fill verification (signed) ────────────────────────────────────────────────

/** Realized execution of an order: actual average price and filled quantity. */
export interface OrderFill {
  orderId: string;
  /** Volume-weighted average fill price (0 if nothing filled). */
  avgPrice: number;
  /** Quantity actually filled (may be < requested on a partial fill). */
  filledQty: number;
  /** Bybit order status: New / PartiallyFilled / Filled / Rejected / Cancelled. */
  status: string;
}

interface RawOrder {
  orderId: string;
  avgPrice?: string;
  cumExecQty?: string;
  orderStatus?: string;
}

/** Look an order up by id: realtime first (fresh), then history (settled). */
async function fetchOrder(symbol: string, orderId: string): Promise<RawOrder | null> {
  const sym = toBybitSymbol(symbol);
  const params = { category: "linear", symbol: sym, orderId };
  for (const path of ["/v5/order/realtime", "/v5/order/history"]) {
    try {
      const r = await signedGet<{ list: RawOrder[] }>(path, params);
      const item = r.list?.find((o) => o.orderId === orderId) ?? r.list?.[0];
      if (item) return item;
    } catch {
      // Try the next source.
    }
  }
  return null;
}

/**
 * Poll an order until it leaves a non-terminal state, returning the realized
 * fill. Market orders settle near-instantly, but there's a small propagation
 * delay before avgPrice/cumExecQty are populated — so we retry briefly.
 */
export async function confirmFill(
  symbol: string,
  orderId: string,
  attempts = 6,
  delayMs = 400,
): Promise<OrderFill> {
  let last: OrderFill = { orderId, avgPrice: 0, filledQty: 0, status: "Unknown" };
  for (let i = 0; i < attempts; i++) {
    const o = await fetchOrder(symbol, orderId);
    if (o) {
      last = {
        orderId,
        avgPrice: Number(o.avgPrice ?? "0") || 0,
        filledQty: Number(o.cumExecQty ?? "0") || 0,
        status: o.orderStatus ?? "Unknown",
      };
      const terminal = ["Filled", "Cancelled", "Rejected", "Deactivated"].includes(last.status);
      if (terminal && last.filledQty > 0) return last;
      if (last.status === "Rejected" || last.status === "Cancelled") return last;
    }
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, delayMs));
  }
  return last;
}

/**
 * Place a market order and confirm its realized fill. Throws if nothing filled
 * (rejected / cancelled / zero-fill) so the caller can roll back the other leg.
 */
export async function placeMarketOrderConfirmed(opts: {
  symbol: string;
  side: OrderSide;
  qty: number;
  reduceOnly?: boolean;
}): Promise<OrderFill> {
  const { orderId } = await placeMarketOrder(opts);
  const fill = await confirmFill(opts.symbol, orderId);
  if (fill.filledQty <= 0) {
    throw new Error(`order ${orderId} did not fill (status=${fill.status})`);
  }
  return fill;
}

// ── Open positions (signed) — for reconciliation ──────────────────────────────

/** A live perpetual position on the account. */
export interface BybitPosition {
  symbol: string;
  side: OrderSide | "None";
  /** Absolute position size in base units (0 when flat). */
  size: number;
  avgPrice: number;
}

/** All open linear (USDT-settled) positions, keyed for reconciliation. */
export async function getOpenPerpPositions(): Promise<BybitPosition[]> {
  const result = await signedGet<{
    list: Array<{ symbol: string; side: string; size: string; avgPrice: string }>;
  }>("/v5/position/list", { category: "linear", settleCoin: "USDT" });
  return (result.list ?? [])
    .map((p) => ({
      symbol: p.symbol,
      side: (p.side === "Buy" || p.side === "Sell" ? p.side : "None") as OrderSide | "None",
      size: Math.abs(Number(p.size) || 0),
      avgPrice: Number(p.avgPrice) || 0,
    }))
    .filter((p) => p.size > 0);
}
