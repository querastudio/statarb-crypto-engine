"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Position } from "@/lib/types";
import { num } from "@/components/format";

const REFRESH_MS = 30_000;

function modeBadge(mode: string) {
  const color = mode === "live" ? "var(--red)" : mode === "testnet" ? "var(--amber)" : "var(--muted)";
  const label = mode === "live" ? "LIVE 💰" : mode === "testnet" ? "TESTNET" : "PAPER";
  return (
    <span style={{ color, border: `1px solid ${color}55`, borderRadius: 6, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function sideBadge(side: string) {
  const isLong = side === "LONG_SPREAD";
  const color = isLong ? "var(--green)" : "var(--red)";
  return <span style={{ color, fontWeight: 700 }}>{isLong ? "🟢 LONG spread" : "🔴 SHORT spread"}</span>;
}

export default function PositionsPage() {
  const [open, setOpen] = useState<Position[]>([]);
  const [closed, setClosed] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      fetch("/api/positions")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (!d.ok) {
            setErr(d.error ?? "Gagal memuat posisi");
            return;
          }
          setOpen(d.open ?? []);
          setClosed(d.closed ?? []);
          setErr(null);
        })
        .catch((e) => alive && setErr((e as Error).message))
        .finally(() => alive && setLoading(false));
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const totalPnl = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Posisi Auto-Trade</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Posisi yang dibuka/ditutup otomatis oleh executor (Bybit USDT Perpetual). Refresh tiap 30 detik.
      </p>

      <div className="notice" style={{ marginBottom: 20 }}>
        ⚙️ Auto-trade dikendalikan env <code>TRADING_ENABLED</code> + <code>TRADING_MODE</code> di Vercel.
        Selama <code>TRADING_ENABLED=no</code>, executor tidak mengirim order apa pun.
      </div>

      {err && <div className="notice" style={{ marginBottom: 16 }}>⚠️ {err}</div>}

      {loading ? (
        <p className="muted">Memuat…</p>
      ) : (
        <>
          {/* ── Open positions ─────────────────────────────────────────────── */}
          <h3 style={{ fontSize: 15 }}>Terbuka ({open.length})</h3>
          {open.length === 0 ? (
            <p className="muted">Tidak ada posisi terbuka saat ini.</p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
              <table>
                <thead>
                  <tr>
                    <th>Pasangan</th>
                    <th>Arah</th>
                    <th>Mode</th>
                    <th title="Z-score saat masuk">Entry z</th>
                    <th>Qty A</th>
                    <th>Qty B</th>
                    <th>Entry A</th>
                    <th>Entry B</th>
                    <th>Dibuka</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{p.symbol_a} / {p.symbol_b}</td>
                      <td>{sideBadge(p.side)}</td>
                      <td>{modeBadge(p.mode)}</td>
                      <td>{num(p.entry_z, 2)}</td>
                      <td>{num(p.qty_a, 4)}</td>
                      <td>{num(p.qty_b, 4)}</td>
                      <td>{num(p.entry_price_a, 4)}</td>
                      <td>{num(p.entry_price_b, 4)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {p.opened_at ? new Date(p.opened_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Closed history ─────────────────────────────────────────────── */}
          <h3 style={{ fontSize: 15 }}>
            Riwayat ({closed.length}){" "}
            {closed.length > 0 && (
              <span style={{ color: totalPnl >= 0 ? "var(--green)" : "var(--red)", fontSize: 13 }}>
                · total PnL ≈ {num(totalPnl, 2)} USDT
              </span>
            )}
          </h3>
          {closed.length === 0 ? (
            <p className="muted">Belum ada posisi yang ditutup.</p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Pasangan</th>
                    <th>Arah</th>
                    <th>Mode</th>
                    <th>Entry z</th>
                    <th>Exit z</th>
                    <th>Alasan keluar</th>
                    <th>PnL (USDT)</th>
                    <th>Ditutup</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{p.symbol_a} / {p.symbol_b}</td>
                      <td>{sideBadge(p.side)}</td>
                      <td>{modeBadge(p.mode)}</td>
                      <td>{num(p.entry_z, 2)}</td>
                      <td>{num(p.exit_z ?? 0, 2)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{p.exit_reason ?? "—"}</td>
                      <td style={{ color: (p.pnl ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                        {num(p.pnl ?? 0, 2)}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {p.closed_at ? new Date(p.closed_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 20 }}>
            PnL bersifat perkiraan (harga close + estimasi fee), bukan settlement resmi Bybit.
            Lihat <Link href="/pairs">Pairs</Link> untuk sinyal terkini.
          </p>
        </>
      )}
    </div>
  );
}
