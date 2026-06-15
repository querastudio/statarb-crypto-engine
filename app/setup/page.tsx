"use client";

import { useState } from "react";
import Link from "next/link";

type Phase = "form" | "needsSchema" | "done" | "error";

const VERCEL_VARS = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", hint: "Project URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", hint: "anon / public key" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", hint: "service_role key (secret)" },
  { key: "CRON_SECRET", hint: 'Buat string acak, misal: "statarb2024secret"' },
];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{ padding: "4px 12px", fontSize: 12 }}
    >
      {copied ? "✓ Copied!" : "Copy"}
    </button>
  );
}

export default function SetupPage() {
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [schemaSql, setSchemaSql] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supabaseUrl: url, serviceKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setScanResult(`❌ ${data.error ?? "Scan gagal"}`);
      } else if (data.pairsFound === 0) {
        const bars = data.alignedBars ?? 0;
        const cand = data.candidatesBeforeBH ?? 0;
        const detail =
          bars < 60
            ? `Hanya ${bars} bar selaras (perlu ≥60) — data exchange sedang tidak lengkap, coba lagi beberapa menit.`
            : cand === 0
            ? `Tidak ada pasangan yang cukup berkorelasi saat ini (${bars} bar selaras). Coba lagi nanti.`
            : `Ada ${cand} kandidat tapi semua tersaring uji statistik ketat (${bars} bar selaras). Coba lagi nanti.`;
        setScanResult(
          `⚠️ 0 pair dari ${data.universeSize} simbol. ${detail}`,
        );
      } else if (!data.saved) {
        setScanResult(
          `⚠️ ${data.pairsFound} pair ditemukan tapi GAGAL disimpan. Error: ${data.saveError ?? "tidak diketahui"}`,
        );
      } else {
        const bhInfo = data.droppedByBH > 0
          ? ` (${data.droppedByBH} pair dibuang koreksi BH, threshold p≤${Number(data.bhThreshold).toFixed(4)})`
          : "";
        setScanResult(
          `✅ ${data.pairsFound} pair disimpan dari ${data.rawUniverseSize ?? data.universeSize} simbol!${bhInfo}`,
        );
      }
    } catch (e) {
      setScanResult(`❌ ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  async function handleTest() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, anonKey, serviceKey }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Gagal terhubung");
        setPhase("error");
      } else if (data.needsSchema) {
        setSchemaSql(data.schemaSql ?? "");
        setSupabaseUrl(data.supabaseUrl ?? url);
        setPhase("needsSchema");
      } else {
        setPhase("done");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 740 }}>
      <h1 style={{ marginTop: 0 }}>Setup Supabase</h1>

      {/* ── STEP 1: Input credentials ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{
            background: phase === "form" || phase === "error" ? "var(--accent)" : "var(--green)",
            color: "#06101f", width: 28, height: 28, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 14, flexShrink: 0,
          }}>1</span>
          <h3 style={{ margin: 0, fontSize: 16 }}>Masukkan data Supabase</h3>
        </div>
        <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
          Ambil dari <strong>Supabase → Project → Settings → API</strong>
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Project URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxxxxxx.supabase.co"
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Anon Key (public)</span>
            <input
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Service Role Key (secret)</span>
            <input
              type="password"
              value={serviceKey}
              onChange={(e) => setServiceKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              style={{ width: "100%" }}
            />
          </label>
        </div>

        {phase === "error" && (
          <div className="notice" style={{ marginTop: 16 }}>⚠️ {error}</div>
        )}

        <button
          className="primary"
          onClick={handleTest}
          disabled={loading || !url || !serviceKey}
          style={{ marginTop: 16 }}
        >
          {loading ? "Mengecek..." : "Test Koneksi"}
        </button>
      </div>

      {/* ── STEP 2: Schema SQL (if tables missing) ────────────────────────── */}
      {(phase === "needsSchema" || phase === "done") && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{
              background: phase === "done" ? "var(--green)" : "var(--accent)",
              color: "#06101f", width: 28, height: 28, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>2</span>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {phase === "done" ? "✅ Tabel sudah ada — skip ke langkah 3" : "Buat tabel di Supabase"}
            </h3>
          </div>

          {phase === "needsSchema" && (
            <>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Tabel belum ada. Copy SQL di bawah, lalu paste di{" "}
                <a
                  href={`${supabaseUrl.replace("https://", "https://supabase.com/dashboard/project/").split(".supabase.co")[0]}/sql/new`}
                  target="_blank"
                  rel="noopener"
                >
                  Supabase → SQL Editor
                </a>{" "}
                dan klik <strong>Run</strong>.
              </p>
              <div style={{ position: "relative" }}>
                <textarea
                  readOnly
                  value={schemaSql}
                  rows={6}
                  style={{ width: "100%", fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                />
                <div style={{ marginTop: 8 }}>
                  <CopyBtn text={schemaSql} />
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noopener"
                    style={{ marginLeft: 12, fontSize: 13 }}
                  >
                    Buka Supabase Dashboard →
                  </a>
                </div>
              </div>
              <button
                className="primary"
                onClick={handleTest}
                disabled={loading}
                style={{ marginTop: 14 }}
              >
                {loading ? "Mengecek..." : "Sudah Run SQL — Cek Lagi"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── STEP 3: Vercel env vars ───────────────────────────────────────── */}
      {(phase === "needsSchema" || phase === "done") && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{
              background: "var(--accent)", color: "#06101f", width: 28, height: 28,
              borderRadius: "50%", display: "flex", alignItems: "center",
              justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>3</span>
            <h3 style={{ margin: 0, fontSize: 16 }}>Tambahkan ke Vercel Environment Variables</h3>
          </div>
          <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
            Buka <strong>Vercel → Project → Settings → Environment Variables</strong>, tambahkan 4 baris ini:
          </p>
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>KEY</th>
                <th style={{ textAlign: "left" }}>VALUE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>NEXT_PUBLIC_SUPABASE_URL</code></td>
                <td style={{ color: "var(--accent)" }}>{url || "URL project kamu"}</td>
                <td><CopyBtn text={url} /></td>
              </tr>
              <tr>
                <td><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></td>
                <td style={{ color: "var(--accent)" }}>{anonKey ? anonKey.slice(0, 20) + "..." : "anon key kamu"}</td>
                <td><CopyBtn text={anonKey} /></td>
              </tr>
              <tr>
                <td><code>SUPABASE_SERVICE_ROLE_KEY</code></td>
                <td style={{ color: "var(--accent)" }}>{"(service role key kamu)"}</td>
                <td><CopyBtn text={serviceKey} /></td>
              </tr>
              <tr>
                <td><code>CRON_SECRET</code></td>
                <td style={{ color: "var(--muted)" }}>{"statarb2024secret (bebas)"}</td>
                <td><CopyBtn text="statarb2024secret" /></td>
              </tr>
            </tbody>
          </table>
          <div className="notice" style={{ marginTop: 16 }}>
            Setelah tambah env vars → klik <strong>Redeploy</strong> di Vercel (Deployments → titik tiga → Redeploy).
          </div>
        </div>
      )}

      {/* ── STEP 4: Done ─────────────────────────────────────────────────── */}
      {phase === "done" && (
        <div className="card" style={{ borderColor: "var(--green)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{
              background: "var(--green)", color: "#06101f", width: 28, height: 28,
              borderRadius: "50%", display: "flex", alignItems: "center",
              justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>4</span>
            <h3 style={{ margin: 0, fontSize: 16 }}>✅ Semua siap! Jalankan scan pertama</h3>
          </div>
          <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
            Klik tombol di bawah untuk mulai scan pair (menggunakan Service Role Key yang kamu masukkan tadi):
          </p>
          <div className="row">
            <button className="primary" onClick={handleScan} disabled={scanning || !serviceKey}>
              {scanning ? "⏳ Scanning... (bisa 30-60 detik)" : "🔍 Jalankan Scan Sekarang"}
            </button>
            <Link href="/pairs">
              <button>Lihat Pairs</button>
            </Link>
            <Link href="/">
              <button>Lihat Dashboard</button>
            </Link>
          </div>
          {scanResult && (
            <div
              className={scanResult.startsWith("✅") ? "notice" : "notice"}
              style={{
                marginTop: 12,
                borderColor: scanResult.startsWith("✅") ? "var(--green)" : undefined,
              }}
            >
              {scanResult}
              {scanResult.startsWith("✅") && (
                <span>
                  {" "}
                  <Link href="/pairs" style={{ color: "var(--green)" }}>
                    → Buka Pairs
                  </Link>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
