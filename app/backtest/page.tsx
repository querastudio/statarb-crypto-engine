"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BacktestResult, BacktestMetrics } from "@/lib/types";
import { EquityChart } from "@/components/EquityChart";
import { ZScoreChart } from "@/components/ZScoreChart";
import { num, pct, signClass } from "@/components/format";

function MetricCard({
  label,
  value,
  cls,
  help,
}: {
  label: string;
  value: string;
  cls?: string;
  help?: string;
}) {
  return (
    <div className="card" title={help}>
      <h3>{label}</h3>
      <div className={`stat small ${cls ?? ""}`}>{value}</div>
      {help && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
          {help}
        </div>
      )}
    </div>
  );
}

function MetricsGrid({ m }: { m: BacktestMetrics }) {
  return (
    <div className="grid cols-4">
      <MetricCard
        label="Total return"
        value={pct(m.totalReturn)}
        cls={signClass(m.totalReturn)}
        help="Total untung/rugi sepanjang periode setelah biaya."
      />
      <MetricCard
        label="Sharpe"
        value={num(m.sharpe)}
        cls={signClass(m.sharpe)}
        help="Untung per unit risiko. >1 bagus, >2 sangat bagus."
      />
      <MetricCard
        label="Sortino"
        value={m.sortino >= 999 ? "≥999 (tanpa bar rugi)" : num(m.sortino)}
        cls={signClass(m.sortino)}
        help="Seperti Sharpe tapi hanya hitung volatilitas turun. Makin tinggi makin baik."
      />
      <MetricCard
        label="Max drawdown"
        value={pct(m.maxDrawdown)}
        cls="neg"
        help="Penurunan terdalam dari puncak. Makin kecil makin aman."
      />
      <MetricCard label="Win rate" value={pct(m.winRate)} help="Persentase trade yang untung." />
      <MetricCard
        label="Profit factor"
        value={Number.isFinite(m.profitFactor) ? num(m.profitFactor) : "∞"}
        help="Total untung ÷ total rugi. >1 artinya profitabel."
      />
      <MetricCard
        label="Trades"
        value={String(m.totalTrades)}
        help="Jumlah trade selesai (masuk lalu keluar)."
      />
      <MetricCard
        label="Avg duration"
        value={`${num(m.avgTradeDurationBars, 1)} bars`}
        help="Rata-rata lama posisi (dalam bar/jam)."
      />
    </div>
  );
}

function BacktestInner() {
  const params = useSearchParams();
  const [symbolA, setSymbolA] = useState("ETH/USDT");
  const [symbolB, setSymbolB] = useState("BTC/USDT");
  const [useKalman, setUseKalman] = useState(true);
  const [entry, setEntry] = useState(2.0);
  const [exitT, setExitT] = useState(0.5);
  const [stop, setStop] = useState(3.5);
  const [window, setWindow] = useState(60);
  const [lookbackBars, setLookbackBars] = useState(300);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = params.get("a");
    const b = params.get("b");
    if (a) setSymbolA(a);
    if (b) setSymbolB(b);
  }, [params]);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbolA,
          symbolB,
          lookbackBars,
          params: {
            useKalman,
            entryThreshold: entry,
            exitThreshold: exitT,
            stopThreshold: stop,
            zscoreWindow: window,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Backtest failed");
      setResult(data as BacktestResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Backtest</h1>
      <p className="muted">
        Event-driven backtest with realistic costs (taker fee per leg + slippage). The dashed amber
        line marks the out-of-sample split; the grey equity line is before-cost, the blue line is
        after-cost.
      </p>

      <div className="card">
        <div className="row">
          <label>
            Symbol A{" "}
            <input value={symbolA} onChange={(e) => setSymbolA(e.target.value)} size={12} />
          </label>
          <label>
            Symbol B{" "}
            <input value={symbolB} onChange={(e) => setSymbolB(e.target.value)} size={12} />
          </label>
          <label>
            Lookback bars{" "}
            <input
              type="number"
              value={lookbackBars}
              onChange={(e) => setLookbackBars(Number(e.target.value))}
              style={{ width: 70 }}
              title="Number of OHLCV bars to fetch (300 recommended for Vercel Hobby)"
            />
          </label>
          <label>
            Window{" "}
            <input
              type="number"
              value={window}
              onChange={(e) => setWindow(Number(e.target.value))}
              style={{ width: 70 }}
            />
          </label>
          <label>
            Entry{" "}
            <input
              type="number"
              step="0.1"
              value={entry}
              onChange={(e) => setEntry(Number(e.target.value))}
              style={{ width: 64 }}
            />
          </label>
          <label>
            Exit{" "}
            <input
              type="number"
              step="0.1"
              value={exitT}
              onChange={(e) => setExitT(Number(e.target.value))}
              style={{ width: 64 }}
            />
          </label>
          <label>
            Stop{" "}
            <input
              type="number"
              step="0.1"
              value={stop}
              onChange={(e) => setStop(Number(e.target.value))}
              style={{ width: 64 }}
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={useKalman}
              onChange={(e) => setUseKalman(e.target.checked)}
              style={{ width: "auto" }}
            />
            Kalman beta
          </label>
          <span className="spacer" />
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run backtest"}
          </button>
        </div>
      </div>

      {error && <div className="notice">⚠️ {error}</div>}

      {result && (
        <>
          <h2 className="section-title">After-cost metrics (full sample)</h2>
          <MetricsGrid m={result.metrics} />

          <h2 className="section-title">Out-of-sample (test) — after cost</h2>
          <MetricsGrid m={result.metricsOOS} />

          <h2 className="section-title">Equity curve</h2>
          <div className="card">
            <EquityChart data={result.equityCurve} oosStartIndex={result.oosStartIndex} />
            <p className="muted" style={{ fontSize: 13 }}>
              Before-cost total return: {pct(result.metricsGross.totalReturn)} · After-cost:{" "}
              {pct(result.metrics.totalReturn)} · Cost drag:{" "}
              {pct(result.metricsGross.totalReturn - result.metrics.totalReturn)}
            </p>
          </div>

          <h2 className="section-title">Z-score path</h2>
          <div className="card">
            <ZScoreChart
              data={result.equityCurve}
              entry={result.params.entryThreshold}
              exit={result.params.exitThreshold}
              stop={result.params.stopThreshold}
            />
          </div>

          <h2 className="section-title">Trades ({result.trades.length})</h2>
          <div className="card" style={{ padding: 0, overflowX: "auto", maxHeight: 420 }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Side</th>
                  <th>Entry z</th>
                  <th>Exit z</th>
                  <th>Bars</th>
                  <th>Net PnL</th>
                  <th>Gross PnL</th>
                  <th>Exit</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{t.side === "LONG_SPREAD" ? "LONG" : "SHORT"}</td>
                    <td>{num(t.entryZ)}</td>
                    <td>{num(t.exitZ)}</td>
                    <td>{t.bars}</td>
                    <td className={signClass(t.pnl)}>{pct(t.pnl)}</td>
                    <td className={signClass(t.grossPnl)}>{pct(t.grossPnl)}</td>
                    <td className="muted">{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="container">Loading…</div>}>
      <BacktestInner />
    </Suspense>
  );
}
