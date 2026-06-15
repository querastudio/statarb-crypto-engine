"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Signal, Pair } from "@/lib/types";
import { num, sideBadgeClass, sideLabel, signClass } from "@/components/format";

interface SignalsResponse {
  configured: boolean;
  signals: Signal[];
}
interface PairsResponse {
  configured: boolean;
  pairs: Pair[];
}

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/signals").then((r) => r.json() as Promise<SignalsResponse>),
      fetch("/api/pairs").then((r) => r.json() as Promise<PairsResponse>),
    ])
      .then(([s, p]) => {
        setSignals(s.signals ?? []);
        setPairs(p.pairs ?? []);
        setConfigured(Boolean(s.configured));
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  // Most-recent signal per pair.
  const latestByPair = new Map<string, Signal>();
  for (const s of signals) {
    const key = `${s.symbol_a}__${s.symbol_b}`;
    if (!latestByPair.has(key)) latestByPair.set(key, s);
  }
  const active = Array.from(latestByPair.values()).filter(
    (s) => s.side === "LONG_SPREAD" || s.side === "SHORT_SPREAD",
  );

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>

      {!configured && (
        <div className="notice">
          Supabase is not configured yet, so there is no stored scan/signal data. Set{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>, run the SQL schema, then trigger{" "}
          <code>/api/cron/scan</code>. You can still run ad-hoc backtests on the{" "}
          <Link href="/backtest">Backtest</Link> page.
        </div>
      )}

      <div className="grid cols-4">
        <div className="card">
          <h3>Cointegrated pairs</h3>
          <div className="stat">{pairs.length}</div>
        </div>
        <div className="card">
          <h3>Open signals</h3>
          <div className="stat">{active.length}</div>
        </div>
        <div className="card">
          <h3>Signals (recent)</h3>
          <div className="stat">{signals.length}</div>
        </div>
        <div className="card">
          <h3>Best score</h3>
          <div className="stat">{pairs[0] ? num(pairs[0].score, 3) : "—"}</div>
        </div>
      </div>

      <h2 className="section-title">Active signals</h2>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : active.length === 0 ? (
        <p className="muted">No open spread positions right now.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Side</th>
                <th>z-score</th>
                <th>beta</th>
                <th>spread</th>
                <th>price A</th>
                <th>price B</th>
                <th>when</th>
              </tr>
            </thead>
            <tbody>
              {active.map((s, i) => (
                <tr key={i}>
                  <td>
                    {s.symbol_a} / {s.symbol_b}
                  </td>
                  <td>
                    <span className={sideBadgeClass(s.side)}>{sideLabel(s.side)}</span>
                  </td>
                  <td className={signClass(s.zscore)}>{num(s.zscore)}</td>
                  <td>{num(s.beta, 4)}</td>
                  <td>{num(s.spread, 4)}</td>
                  <td>{num(s.price_a, 4)}</td>
                  <td>{num(s.price_b, 4)}</td>
                  <td className="muted">
                    {s.created_at ? new Date(s.created_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">Top pairs by score</h2>
      {pairs.length === 0 ? (
        <p className="muted">
          No pairs yet. Run a scan (<code>/api/cron/scan</code>) or see{" "}
          <Link href="/pairs">Pairs</Link>.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>score</th>
                <th>ADF p</th>
                <th>half-life</th>
                <th>Hurst</th>
                <th>corr</th>
                <th>beta</th>
              </tr>
            </thead>
            <tbody>
              {pairs.slice(0, 10).map((p, i) => (
                <tr key={i}>
                  <td>
                    {p.symbol_a} / {p.symbol_b}
                  </td>
                  <td>{num(p.score, 3)}</td>
                  <td>{num(p.adf_pvalue, 4)}</td>
                  <td>{num(p.half_life, 1)}</td>
                  <td>{num(p.hurst, 2)}</td>
                  <td>{num(p.correlation, 2)}</td>
                  <td>{num(p.beta, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="disclaimer">
        ⚠️ Research &amp; education only. Statistical arbitrage carries real risk: cointegration can
        break, fees and slippage erode thin edges, and backtests do not guarantee live results.
        Paper-trade first and start small.
      </p>
    </div>
  );
}
