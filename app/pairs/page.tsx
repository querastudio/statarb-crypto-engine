"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Pair } from "@/lib/types";
import { num } from "@/components/format";

export default function PairsPage() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);

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
      <h1 style={{ marginTop: 0 }}>Cointegrated pairs</h1>
      <p className="muted">
        Ranked by composite score (low ADF p-value, ideal half-life, low Hurst). Each pair has
        passed the correlation pre-filter, the Engle-Granger cointegration test, the half-life
        window, and the Hurst &lt; 0.5 confirmation.
      </p>

      {!configured && (
        <div className="notice">
          Supabase not configured — no stored pairs. Configure env vars and run{" "}
          <code>/api/cron/scan</code> to populate this list.
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : pairs.length === 0 ? (
        <p className="muted">No pairs found yet.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Pair</th>
                <th>Score</th>
                <th>ADF p-value</th>
                <th>Half-life (bars)</th>
                <th>Hurst</th>
                <th>Correlation</th>
                <th>Beta</th>
                <th>Backtest</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {p.symbol_a} / {p.symbol_b}
                  </td>
                  <td>{num(p.score, 3)}</td>
                  <td>{num(p.adf_pvalue, 4)}</td>
                  <td>{num(p.half_life, 1)}</td>
                  <td>{num(p.hurst, 2)}</td>
                  <td>{num(p.correlation, 2)}</td>
                  <td>{num(p.beta, 4)}</td>
                  <td>
                    <Link
                      href={`/backtest?a=${encodeURIComponent(p.symbol_a)}&b=${encodeURIComponent(
                        p.symbol_b,
                      )}`}
                    >
                      run →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
