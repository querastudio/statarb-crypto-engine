"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Signal, Pair } from "@/lib/types";
import { analyzePortfolio, type PortfolioRisk } from "@/lib/engine/portfolio";
import { num, sideBadgeClass, sideLabel, signClass } from "@/components/format";

interface SignalsResponse {
  configured: boolean;
  signals: Signal[];
}
interface PairsResponse {
  configured: boolean;
  pairs: Pair[];
}

function actionText(side: string, a: string, b: string): string {
  switch (side) {
    case "LONG_SPREAD":
      return `Beli ${a}, jual ${b}`;
    case "SHORT_SPREAD":
      return `Jual ${a}, beli ${b}`;
    case "CLOSE":
      return "Tutup posisi (ambil untung)";
    case "STOP":
      return "Stop / cut loss";
    default:
      return "Tunggu";
  }
}

function PortfolioHealthCard({ risk }: { risk: PortfolioRisk }) {
  const color =
    risk.verdict === "SAFE"
      ? "var(--green)"
      : risk.verdict === "CAUTION"
      ? "var(--amber)"
      : "var(--red)";

  const verdictLabel =
    risk.verdict === "SAFE"
      ? "🟢 AMAN"
      : risk.verdict === "CAUTION"
      ? "⚠️ WASPADA"
      : "🔴 BERBAHAYA";

  const utilPct = Math.min(1, risk.utilizationPct) * 100;
  const longPct = risk.totalOpen > 0 ? (risk.longCount / risk.totalOpen) * 100 : 50;

  return (
    <div
      className="card"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color }}>{verdictLabel}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            Kesehatan portfolio — {risk.totalOpen} posisi terbuka dari {risk.maxPositions} maksimum
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
          <span>Kapasitas posisi</span>
          <span>{risk.totalOpen}/{risk.maxPositions} ({Math.round(utilPct)}%)</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${utilPct}%`,
              background: utilPct >= 100 ? "var(--red)" : utilPct >= 80 ? "var(--amber)" : "var(--green)",
              borderRadius: 4,
              transition: "width 0.3s",
            }}
          />
        </div>
      </div>

      {/* Long/Short balance bar */}
      {risk.totalOpen > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            <span style={{ color: "var(--green)" }}>▲ LONG: {risk.longCount}</span>
            <span style={{ color: "var(--muted)" }}>Keseimbangan pasar</span>
            <span style={{ color: "var(--red)" }}>SHORT: {risk.shortCount} ▼</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "rgba(239,83,80,0.3)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${longPct}%`,
                background: "rgba(38,166,154,0.6)",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, textAlign: "center" }}>
            {risk.isNeutral ? "✓ Cukup netral (ideal: 50/50)" : "⚠ Tidak netral — risiko arah pasar"}
          </div>
        </div>
      )}

      {/* Warnings */}
      {risk.warnings.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {risk.warnings.map((w, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: "var(--text)",
                padding: "7px 10px",
                background: "rgba(255,160,0,0.08)",
                border: "1px solid rgba(255,160,0,0.25)",
                borderRadius: 6,
              }}
            >
              ⚠ {w}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          ✓ Tidak ada peringatan — portfolio dalam kondisi baik
        </div>
      )}
    </div>
  );
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

  const portfolioRisk = analyzePortfolio(active, pairs, 10);

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Ringkasan mesin statistical arbitrage. Engine memindai pasangan koin yang bergerak bersamaan,
        lalu memberi sinyal saat selisihnya melebar (peluang masuk) atau menyempit (waktunya keluar).
      </p>

      {!configured && (
        <div className="notice">
          Supabase belum terkonfigurasi. Buka <Link href="/setup">Setup</Link> untuk menghubungkan
          database dan menjalankan scan pertama.
        </div>
      )}

      <div className="grid cols-4">
        <div className="card">
          <h3>Pasangan ditemukan</h3>
          <div className="stat">{pairs.length}</div>
          <div className="muted" style={{ fontSize: 12 }}>lolos uji statistik</div>
        </div>
        <div className="card">
          <h3>Sinyal aktif</h3>
          <div className="stat">{active.length}</div>
          <div className="muted" style={{ fontSize: 12 }}>peluang masuk sekarang</div>
        </div>
        <div className="card">
          <h3>Total sinyal (riwayat)</h3>
          <div className="stat">{signals.length}</div>
          <div className="muted" style={{ fontSize: 12 }}>termasuk tutup &amp; stop</div>
        </div>
        <div className="card">
          <h3>Score terbaik</h3>
          <div className="stat">{pairs[0] ? num(pairs[0].score, 3) : "—"}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {pairs[0] ? `${pairs[0].symbol_a}/${pairs[0].symbol_b}` : "belum ada"}
          </div>
        </div>
      </div>

      {/* Portfolio Health */}
      {!loading && active.length > 0 && (
        <>
          <h2 className="section-title">Kesehatan portfolio</h2>
          <PortfolioHealthCard risk={portfolioRisk} />
        </>
      )}

      <h2 className="section-title">Sinyal aktif — peluang masuk sekarang</h2>
      {loading ? (
        <p className="muted">Memuat…</p>
      ) : active.length === 0 ? (
        <div className="notice">
          Belum ada peluang masuk dari sinyal tersimpan. Itu normal — sinyal hanya muncul saat
          z-score sebuah pair melewati ±2. Untuk cek kondisi terkini tiap pair secara langsung, buka{" "}
          <Link href="/pairs">Pairs</Link> dan klik &ldquo;Cek sinyal&rdquo;.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Pasangan</th>
                <th>Sinyal</th>
                <th>Aksi yang disarankan</th>
                <th>z-score</th>
                <th>Beta</th>
                <th>Waktu</th>
              </tr>
            </thead>
            <tbody>
              {active.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>
                    {s.symbol_a} / {s.symbol_b}
                  </td>
                  <td>
                    <span className={sideBadgeClass(s.side)}>{sideLabel(s.side)}</span>
                  </td>
                  <td style={{ textAlign: "left" }}>{actionText(s.side, s.symbol_a, s.symbol_b)}</td>
                  <td className={signClass(s.zscore)}>{num(s.zscore)}</td>
                  <td>{num(s.beta, 4)}</td>
                  <td className="muted">
                    {s.created_at ? new Date(s.created_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">Pasangan terbaik berdasarkan score</h2>
      {pairs.length === 0 ? (
        <p className="muted">
          Belum ada pair. Buka <Link href="/setup">Setup</Link> lalu jalankan scan.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Pasangan</th>
                <th>Score</th>
                <th>ADF p</th>
                <th>Half-life</th>
                <th>Hurst</th>
                <th>Korelasi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pairs.slice(0, 10).map((p, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>
                    {p.symbol_a} / {p.symbol_b}
                  </td>
                  <td>{num(p.score, 3)}</td>
                  <td>{num(p.adf_pvalue, 4)}</td>
                  <td>{num(p.half_life, 1)}</td>
                  <td>{num(p.hurst, 2)}</td>
                  <td>{num(p.correlation, 2)}</td>
                  <td>
                    <Link href="/pairs">lihat →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="disclaimer">
        ⚠️ Hanya untuk riset &amp; edukasi. Statistical arbitrage punya risiko nyata: kointegrasi bisa
        putus, biaya &amp; slippage menggerus margin tipis, dan hasil backtest tidak menjamin hasil live.
        Paper-trade dulu dan mulai dengan modal kecil.
      </p>
    </div>
  );
}
