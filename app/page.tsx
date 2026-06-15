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

      <h2 className="section-title">Sinyal aktif — peluang masuk sekarang</h2>
      {loading ? (
        <p className="muted">Memuat…</p>
      ) : active.length === 0 ? (
        <div className="notice">
          Belum ada peluang masuk dari sinyal tersimpan. Itu normal — sinyal hanya muncul saat
          z-score sebuah pair melewati ±2. Untuk cek kondisi terkini tiap pair secara langsung, buka{" "}
          <Link href="/pairs">Pairs</Link> dan klik “Cek sinyal”.
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
