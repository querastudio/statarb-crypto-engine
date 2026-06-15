"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Pair } from "@/lib/types";
import {
  num,
  qualityClass,
  qualityIcon,
  adfQuality,
  halfLifeQuality,
  hurstQuality,
  corrQuality,
  scoreQuality,
} from "@/components/format";
import { ZScoreGauge, type Thresholds } from "@/components/ZScoreGauge";

interface LiveSignal {
  symbol_a: string;
  symbol_b: string;
  side: string;
  zscore: number;
  beta: number;
  spread: number;
  price_a: number;
  price_b: number;
  thresholds: Thresholds;
  history: Array<{ t: number; z: number }>;
  asOf: number;
  error?: string;
}

// ── Plain-language explainer of how to read the table ──────────────────────────
function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div
        style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: 8 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 18 }}>💡</span>
        <h3 style={{ margin: 0, fontSize: 15, color: "var(--text)", textTransform: "none", letterSpacing: 0 }}>
          Cara baca tabel ini & kapan masuk/keluar (klik untuk {open ? "tutup" : "buka"})
        </h3>
        <span className="spacer" />
        <span className="muted">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.7, color: "var(--muted)" }}>
          <p style={{ marginTop: 0 }}>
            <strong style={{ color: "var(--text)" }}>Apa itu pairs trading?</strong> Kita cari 2 koin
            yang harganya bergerak <em>bersamaan</em> dalam jangka panjang (cointegrated). Saat sesekali
            keduanya “berpisah” terlalu jauh, kita bertaruh mereka akan kembali menyatu — beli yang
            ketinggalan, jual yang kemahalan, lalu tutup saat sudah menyatu lagi. Untungnya dari
            <em> selisih</em>, bukan dari arah pasar.
          </p>

          <p>
            <strong style={{ color: "var(--text)" }}>Arti tiap kolom:</strong>
          </p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
            <li><strong>Score</strong> — nilai gabungan kualitas pair (makin tinggi makin bagus). Sudah diurutkan dari terbaik.</li>
            <li><strong>ADF p-value</strong> — bukti statistik bahwa selisihnya “mean-reverting” (suka kembali ke rata-rata). Makin <em>kecil</em> makin bagus. <span className="pos">✓ ≤0.01 sangat kuat</span>, ~ ≤0.05 oke, <span className="neg">✗ &gt;0.05 lemah</span>.</li>
            <li><strong>Half-life</strong> — perkiraan berapa <em>bar/jam</em> sampai selisih kembali setengah jalan ke normal. Ini ekspektasi lama posisi. <span className="pos">✓ 2–30 ideal</span>.</li>
            <li><strong>Hurst</strong> — &lt;0.5 artinya mean-reverting (bagus); makin kecil makin kuat. <span className="pos">✓ &lt;0.4</span>.</li>
            <li><strong>Correlation</strong> — seberapa erat keduanya bergerak bareng. <span className="pos">✓ ≥0.85</span>.</li>
            <li><strong>Beta</strong> — rasio hedge: untuk tiap 1 unit koin A, pakai <em>beta</em> unit koin B agar netral pasar.</li>
          </ul>

          <p>
            <strong style={{ color: "var(--text)" }}>Kapan MASUK & KELUAR (aturan z-score):</strong>
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><span className="pos">📈 z &lt; −2</span> → <strong>MASUK LONG</strong>: beli A, jual B (A terlalu murah).</li>
            <li><span className="neg">📉 z &gt; +2</span> → <strong>MASUK SHORT</strong>: jual A, beli B (A terlalu mahal).</li>
            <li><span className="muted">✅ |z| &lt; 0.5</span> → <strong>TUTUP</strong> posisi, ambil untung (selisih sudah normal).</li>
            <li><span className="neg">🛑 |z| &gt; 3.5</span> → <strong>STOP</strong>: batal/cut loss (hubungan mungkin rusak).</li>
          </ul>
          <p style={{ marginBottom: 0, marginTop: 12 }}>
            👉 Klik tombol <strong>“Cek sinyal”</strong> di tiap baris untuk lihat z-score koin itu
            <em> sekarang</em> dan dapat rekomendasi otomatis.
          </p>
        </div>
      )}
    </div>
  );
}

function QCell({ value, q }: { value: string; q: ReturnType<typeof adfQuality> }) {
  return (
    <td>
      <span className={qualityClass(q)} title={`Kualitas: ${q}`}>
        {qualityIcon(q)} {value}
      </span>
    </td>
  );
}

function LivePanel({ pair, onClose }: { pair: Pair; onClose?: () => void }) {
  const [sig, setSig] = useState<LiveSignal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/signal-live?a=${encodeURIComponent(pair.symbol_a)}&b=${encodeURIComponent(pair.symbol_b)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setSig(d);
      })
      .catch((e) => {
        if (alive) setSig({ error: (e as Error).message } as LiveSignal);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pair.symbol_a, pair.symbol_b]);

  if (loading) return <div className="muted" style={{ padding: 16 }}>Mengambil harga terbaru…</div>;
  if (!sig || sig.error)
    return <div className="notice" style={{ margin: 16 }}>⚠️ {sig?.error ?? "Gagal mengambil sinyal"}</div>;

  return (
    <div style={{ padding: "8px 16px 20px" }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={onClose} style={{ padding: "4px 12px", fontSize: 13 }}>
            ✕ Tutup
          </button>
        </div>
      )}
      <ZScoreGauge
        z={sig.zscore}
        thresholds={sig.thresholds}
        symbolA={sig.symbol_a}
        symbolB={sig.symbol_b}
      />
      <div className="row" style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
        <span>Beta (hedge ratio): <strong style={{ color: "var(--text)" }}>{num(sig.beta, 4)}</strong></span>
        <span>·</span>
        <span>Harga {sig.symbol_a}: <strong style={{ color: "var(--text)" }}>{num(sig.price_a, 4)}</strong></span>
        <span>·</span>
        <span>Harga {sig.symbol_b}: <strong style={{ color: "var(--text)" }}>{num(sig.price_b, 4)}</strong></span>
        <span className="spacer" />
        <Link
          href={`/backtest?a=${encodeURIComponent(sig.symbol_a)}&b=${encodeURIComponent(sig.symbol_b)}`}
        >
          <button className="primary">Uji strategi (backtest) →</button>
        </Link>
      </div>
    </div>
  );
}

export default function PairsPage() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/pairs")
      .then((r) => r.json())
      .then((d) => {
        setPairs(d.pairs ?? []);
        setConfigured(Boolean(d.configured));
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Pasangan koin (cointegrated pairs)</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Daftar pasangan yang lolos semua uji statistik. Diurutkan dari yang paling layak ditradingkan.
      </p>

      <HowItWorks />

      {!configured && (
        <div className="notice">
          Supabase belum terkonfigurasi. Buka <Link href="/setup">Setup</Link> untuk menghubungkan
          database lalu jalankan scan.
        </div>
      )}

      {loading ? (
        <p className="muted">Memuat…</p>
      ) : pairs.length === 0 ? (
        <p className="muted">
          Belum ada pair. Buka <Link href="/setup">Setup</Link> dan klik “Jalankan Scan Sekarang”.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Pasangan</th>
                <th title="Nilai gabungan kualitas — makin tinggi makin baik">Score</th>
                <th title="Bukti mean-reversion — makin kecil makin baik">ADF p</th>
                <th title="Perkiraan lama posisi (bar) sampai selisih kembali separuh jalan">Half-life</th>
                <th title="<0.5 = mean-reverting">Hurst</th>
                <th title="Keeratan gerak bareng">Korelasi</th>
                <th title="Rasio hedge B per 1 unit A">Beta</th>
                <th style={{ position: "sticky", right: 0, background: "var(--panel)" }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <Row
                  key={i}
                  i={i}
                  p={p}
                  open={openIdx === i}
                  onToggle={() => setOpenIdx(openIdx === i ? null : i)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  i,
  p,
  open,
  onToggle,
}: {
  i: number;
  p: Pair;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr style={{ background: open ? "var(--panel-2)" : undefined }}>
        <td>{i + 1}</td>
        <td style={{ fontWeight: 600 }}>
          {p.symbol_a} / {p.symbol_b}
        </td>
        <QCell value={num(p.score, 3)} q={scoreQuality(p.score)} />
        <QCell value={num(p.adf_pvalue, 4)} q={adfQuality(p.adf_pvalue)} />
        <QCell value={num(p.half_life, 1)} q={halfLifeQuality(p.half_life)} />
        <QCell value={num(p.hurst, 2)} q={hurstQuality(p.hurst)} />
        <QCell value={num(p.correlation, 2)} q={corrQuality(p.correlation)} />
        <td>{num(p.beta, 4)}</td>
        <td style={{ position: "sticky", right: 0, background: open ? "var(--panel-2)" : "var(--panel)" }}>
          <button onClick={onToggle} style={{ padding: "4px 12px", fontSize: 13 }}>
            {open ? "Tutup" : "Cek sinyal"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ padding: 0, background: "var(--panel-2)" }}>
            <LivePanel pair={p} onClose={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}
