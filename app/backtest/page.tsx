"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BacktestResult, BacktestMetrics, WalkForwardResult } from "@/lib/types";
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

function WalkForwardPanel({ wf }: { wf: WalkForwardResult }) {
  const verdict = wf.isRobust
    ? { icon: "✅", label: "Strategi Konsisten & Robust", color: "var(--green)" }
    : wf.consistencyPct >= 0.5
    ? { icon: "⚠️", label: "Setengah Konsisten — hati-hati", color: "var(--amber)" }
    : { icon: "❌", label: "Tidak Konsisten — strategi belum handal", color: "var(--red)" };

  const maxAbs = Math.max(...wf.folds.map((f) => Math.abs(f.totalReturn)), 0.01);

  return (
    <div>
      {/* Verdict */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderRadius: 10,
          background: "var(--panel-2)",
          border: `1px solid ${verdict.color}`,
          borderLeft: `5px solid ${verdict.color}`,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: verdict.color }}>
            {verdict.icon} {verdict.label}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>
            {Math.round(wf.consistencyPct * 100)}% periode menguntungkan ·
            Avg Sharpe {num(wf.avgSharpe)} ·
            Avg Return {pct(wf.avgReturn)}
          </div>
        </div>
      </div>

      {/* Visual bar chart per fold */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 64, marginBottom: 8 }}>
        {wf.folds.map((f) => {
          const isPos = f.totalReturn >= 0;
          const barH = Math.max(4, Math.abs(f.totalReturn / maxAbs) * 56);
          return (
            <div key={f.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11, color: isPos ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                {pct(f.totalReturn)}
              </span>
              <div style={{ width: "100%", display: "flex", alignItems: isPos ? "flex-end" : "flex-start", height: 40 }}>
                <div
                  style={{
                    width: "100%",
                    height: barH,
                    background: isPos ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)",
                    border: `1px solid ${isPos ? "var(--green)" : "var(--red)"}`,
                    borderRadius: 3,
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{f.label}</span>
            </div>
          );
        })}
      </div>

      {/* Per-fold table */}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Periode</th>
              <th>Return</th>
              <th>Sharpe</th>
              <th>Max DD</th>
              <th>Trades</th>
              <th>Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {wf.folds.map((f) => (
              <tr key={f.label}>
                <td style={{ fontWeight: 600 }}>{f.label}</td>
                <td className={signClass(f.totalReturn)}>{pct(f.totalReturn)}</td>
                <td className={signClass(f.sharpe)}>{num(f.sharpe)}</td>
                <td className="neg">{pct(f.maxDrawdown)}</td>
                <td>{f.totalTrades}</td>
                <td>{pct(f.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Walk-forward membagi periode OOS menjadi {wf.folds.length} irisan waktu yang tidak tumpang tindih.
        Strategi yang bagus harus menguntungkan di sebagian besar irisan — bukan hanya satu periode.
      </p>
    </div>
  );
}

function BacktestInner() {
  const params = useSearchParams();
  const [symbolA, setSymbolA] = useState("ETH/USDT");
  const [symbolB, setSymbolB] = useState("BTC/USDT");
  const [useKalman, setUseKalman] = useState(true);
  const [useRegimeFilter, setUseRegimeFilter] = useState(false);
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
            useRegimeFilter,
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
          <label className="row" style={{ gap: 6 }} title="Skip entri baru saat regime detector mendeteksi kondisi DANGER">
            <input
              type="checkbox"
              checked={useRegimeFilter}
              onChange={(e) => setUseRegimeFilter(e.target.checked)}
              style={{ width: "auto" }}
            />
            Regime filter
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

          {result.walkForward && (
            <>
              <h2 className="section-title">
                Konsistensi strategi (walk-forward)
              </h2>
              <div className="card">
                <WalkForwardPanel wf={result.walkForward} />
              </div>
            </>
          )}

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
