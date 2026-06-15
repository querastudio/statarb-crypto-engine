"use client";

// Visual z-score gauge: shows where the current spread sits relative to the
// entry / exit / stop bands, with a plain-language verdict telling the user
// exactly what to do (enter long, enter short, wait, take profit, stop out).

export interface Thresholds {
  entryThreshold: number;
  exitThreshold: number;
  stopThreshold: number;
}

export interface Verdict {
  title: string;
  detail: string;
  color: string;
  badge: string;
}

export function verdictFor(
  z: number,
  t: Thresholds,
  symbolA: string,
  symbolB: string,
): Verdict {
  const az = Math.abs(z);
  if (az > t.stopThreshold) {
    return {
      badge: "STOP",
      color: "var(--red)",
      title: "🛑 STOP — jangan masuk / tutup posisi",
      detail: `z-score (${z.toFixed(2)}) sudah melewati batas stop (${t.stopThreshold}). Spread terlalu ekstrem — kemungkinan hubungan dua koin ini sedang rusak (structural break). Hindari atau tutup posisi untuk batasi kerugian.`,
    };
  }
  if (z > t.entryThreshold) {
    return {
      badge: "SHORT SPREAD",
      color: "var(--red)",
      title: `📉 MASUK SHORT SPREAD sekarang`,
      detail: `z-score (${z.toFixed(2)}) di atas +${t.entryThreshold}. Artinya ${symbolA} terlalu MAHAL relatif ke ${symbolB}. Aksi: JUAL (short) ${symbolA}, dan BELI (long) ${symbolB} sebesar beta. Target untung: saat z kembali ke 0.`,
    };
  }
  if (z < -t.entryThreshold) {
    return {
      badge: "LONG SPREAD",
      color: "var(--green)",
      title: `📈 MASUK LONG SPREAD sekarang`,
      detail: `z-score (${z.toFixed(2)}) di bawah -${t.entryThreshold}. Artinya ${symbolA} terlalu MURAH relatif ke ${symbolB}. Aksi: BELI (long) ${symbolA}, dan JUAL (short) ${symbolB} sebesar beta. Target untung: saat z kembali ke 0.`,
    };
  }
  if (az < t.exitThreshold) {
    return {
      badge: "CLOSE / FLAT",
      color: "var(--muted)",
      title: "✅ ZONA TUTUP — ambil untung / tidak ada posisi baru",
      detail: `z-score (${z.toFixed(2)}) sudah dekat 0 (di bawah ${t.exitThreshold}). Spread sudah kembali normal. Kalau kamu sedang punya posisi, INI saatnya tutup & ambil untung. Kalau belum punya posisi, tidak ada peluang masuk sekarang — tunggu.`,
    };
  }
  return {
    badge: "TUNGGU",
    color: "var(--amber)",
    title: "⏳ TUNGGU — belum ada sinyal",
    detail: `z-score (${z.toFixed(2)}) berada di zona netral (antara ${t.exitThreshold} dan ${t.entryThreshold}). Belum cukup ekstrem untuk masuk, belum cukup dekat 0 untuk tutup. Sabar tunggu sampai z menyentuh ±${t.entryThreshold}.`,
  };
}

/** Map a z value to a 0..100% horizontal position on the gauge. */
function zToPct(z: number, max: number): number {
  const clamped = Math.max(-max, Math.min(max, z));
  return ((clamped + max) / (2 * max)) * 100;
}

export function ZScoreGauge({
  z,
  thresholds,
  symbolA,
  symbolB,
}: {
  z: number;
  thresholds: Thresholds;
  symbolA: string;
  symbolB: string;
}) {
  const max = Math.max(thresholds.stopThreshold + 0.5, Math.abs(z) + 0.5);
  const v = verdictFor(z, thresholds, symbolA, symbolB);
  const pos = zToPct(z, max);

  // Band boundaries as percentages.
  const entryPos = thresholds.entryThreshold;
  const stopPos = thresholds.stopThreshold;
  const exitPos = thresholds.exitThreshold;

  const mark = (zVal: number) => `${zToPct(zVal, max)}%`;

  return (
    <div>
      {/* Verdict banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 10,
          background: "var(--panel-2)",
          border: `1px solid ${v.color}`,
          borderLeft: `4px solid ${v.color}`,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: v.color }}>{v.title}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
            {v.detail}
          </div>
        </div>
      </div>

      {/* Gauge bar */}
      <div style={{ position: "relative", height: 56, marginTop: 28, marginBottom: 28 }}>
        {/* Colored zones: stop(red) | entry(green/red) | neutral | exit(grey) | neutral | entry | stop */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 8,
            overflow: "hidden",
            display: "flex",
            background: "var(--panel-2)",
          }}
        >
          {/* left stop */}
          <div style={{ width: mark(-stopPos), background: "rgba(239,83,80,0.30)" }} />
          {/* left entry (long) */}
          <div
            style={{
              width: `calc(${mark(-entryPos)} - ${mark(-stopPos)})`,
              background: "rgba(38,166,154,0.28)",
            }}
          />
          {/* left neutral */}
          <div style={{ width: `calc(${mark(-exitPos)} - ${mark(-entryPos)})` }} />
          {/* exit zone */}
          <div
            style={{
              width: `calc(${mark(exitPos)} - ${mark(-exitPos)})`,
              background: "rgba(139,147,167,0.22)",
            }}
          />
          {/* right neutral */}
          <div style={{ width: `calc(${mark(entryPos)} - ${mark(exitPos)})` }} />
          {/* right entry (short) */}
          <div
            style={{
              width: `calc(${mark(stopPos)} - ${mark(entryPos)})`,
              background: "rgba(239,83,80,0.28)",
            }}
          />
          {/* right stop */}
          <div style={{ flex: 1, background: "rgba(239,83,80,0.30)" }} />
        </div>

        {/* Current-z marker */}
        <div
          style={{
            position: "absolute",
            left: `${pos}%`,
            top: -6,
            bottom: -6,
            width: 3,
            background: v.color,
            transform: "translateX(-50%)",
            borderRadius: 2,
            boxShadow: `0 0 8px ${v.color}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${pos}%`,
            top: -26,
            transform: "translateX(-50%)",
            fontSize: 13,
            fontWeight: 700,
            color: v.color,
            whiteSpace: "nowrap",
          }}
        >
          z = {z.toFixed(2)}
        </div>

        {/* Threshold tick labels */}
        {[
          { z: -stopPos, label: `-${stopPos}` },
          { z: -entryPos, label: `-${entryPos}` },
          { z: 0, label: "0" },
          { z: entryPos, label: `+${entryPos}` },
          { z: stopPos, label: `+${stopPos}` },
        ].map((tk) => (
          <div
            key={tk.label}
            style={{
              position: "absolute",
              left: mark(tk.z),
              bottom: -22,
              transform: "translateX(-50%)",
              fontSize: 11,
              color: "var(--muted)",
            }}
          >
            {tk.label}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        <span><span style={{ color: "var(--green)" }}>■</span> Zona LONG (z &lt; -{entryPos})</span>
        <span><span style={{ color: "var(--muted)" }}>■</span> Zona TUTUP (|z| &lt; {exitPos})</span>
        <span><span style={{ color: "var(--red)" }}>■</span> Zona SHORT (z &gt; +{entryPos})</span>
        <span><span style={{ color: "var(--red)" }}>■</span> Zona STOP (|z| &gt; {stopPos})</span>
      </div>
    </div>
  );
}
