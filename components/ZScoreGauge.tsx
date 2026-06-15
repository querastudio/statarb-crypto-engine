"use client";

export interface Thresholds {
  entryThreshold: number;
  exitThreshold: number;
  stopThreshold: number;
}

interface Step {
  text: string;
  highlight: "buy" | "sell" | "warn" | "info";
}

export interface Verdict {
  badge: string;
  title: string;
  detail: string;
  color: string;
  steps: Step[];
  alertText?: string;
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
      badge: "🛑 STOP",
      color: "var(--red)",
      title: "Hubungan koin mungkin rusak — keluar sekarang",
      detail: `z-score ${z.toFixed(2)} sudah melampaui batas stop ±${t.stopThreshold}. Kointegrasi bisa putus; risiko tinggi.`,
      steps: [
        { text: `Punya posisi? → TUTUP SEGERA untuk batasi kerugian`, highlight: "warn" },
        { text: "Belum punya posisi? → JANGAN masuk", highlight: "warn" },
        { text: "Tunggu z kembali ke zona normal sebelum trading lagi", highlight: "info" },
      ],
    };
  }

  if (z > t.entryThreshold) {
    return {
      badge: "📉 SHORT SPREAD",
      color: "var(--red)",
      title: `${symbolA} terlalu MAHAL — saatnya short`,
      detail: `z = ${z.toFixed(2)} (di atas +${t.entryThreshold}). ${symbolA} overpriced relatif ke ${symbolB}. Ekspektasi: selisih akan menyempit kembali.`,
      steps: [
        { text: `JUAL (short)  ${symbolA}`, highlight: "sell" },
        { text: `BELI (long)   ${symbolB}  ×  beta`, highlight: "buy" },
        { text: `TUTUP kedua posisi saat z kembali mendekati 0`, highlight: "info" },
        { text: `STOP jika z naik melewati +${t.stopThreshold}`, highlight: "warn" },
      ],
    };
  }

  if (z < -t.entryThreshold) {
    return {
      badge: "📈 LONG SPREAD",
      color: "var(--green)",
      title: `${symbolA} terlalu MURAH — saatnya long`,
      detail: `z = ${z.toFixed(2)} (di bawah −${t.entryThreshold}). ${symbolA} underpriced relatif ke ${symbolB}. Ekspektasi: selisih akan menyempit kembali.`,
      steps: [
        { text: `BELI (long)   ${symbolA}`, highlight: "buy" },
        { text: `JUAL (short)  ${symbolB}  ×  beta`, highlight: "sell" },
        { text: `TUTUP kedua posisi saat z kembali mendekati 0`, highlight: "info" },
        { text: `STOP jika z turun melewati −${t.stopThreshold}`, highlight: "warn" },
      ],
    };
  }

  if (az < t.exitThreshold) {
    return {
      badge: "✅ TUTUP POSISI",
      color: "var(--muted)",
      title: "Spread sudah normal — ambil untung sekarang",
      detail: `z = ${z.toFixed(2)} (dekat 0). Jika kamu sedang punya posisi, INI saat yang tepat untuk tutup dan realisasi profit.`,
      steps: [
        { text: `Posisi LONG → JUAL ${symbolA}  +  BELI ${symbolB}`, highlight: "info" },
        { text: `Posisi SHORT → BELI ${symbolA}  +  JUAL ${symbolB}`, highlight: "info" },
        { text: `Tidak punya posisi? Tunggu z bergerak ke ±${t.entryThreshold}`, highlight: "info" },
      ],
    };
  }

  const nearLong = z < 0;
  return {
    badge: "⏳ TUNGGU",
    color: "var(--amber)",
    title: "Zona netral — belum ada peluang masuk",
    detail: `z = ${z.toFixed(2)}. Belum cukup ekstrem untuk masuk, belum cukup dekat 0 untuk tutup posisi.`,
    alertText: nearLong
      ? `z sedang mendekati zona LONG (−${t.entryThreshold}). Siap-siap jika z turun ke −${t.entryThreshold}!`
      : `z sedang mendekati zona SHORT (+${t.entryThreshold}). Siap-siap jika z naik ke +${t.entryThreshold}!`,
    steps: [
      { text: `Sinyal LONG muncul jika z turun ke −${t.entryThreshold}  →  Beli ${symbolA}, Jual ${symbolB}`, highlight: "buy" },
      { text: `Sinyal SHORT muncul jika z naik ke +${t.entryThreshold}  →  Jual ${symbolA}, Beli ${symbolB}`, highlight: "sell" },
      { text: "Jangan masuk sebelum sinyal jelas — sabar adalah strategi", highlight: "warn" },
    ],
  };
}

const STEP_STYLE: Record<Step["highlight"], { bg: string; border: string; color: string; icon: string }> = {
  buy:  { bg: "rgba(38,166,154,0.12)",  border: "rgba(38,166,154,0.3)",  color: "var(--green)", icon: "▲ BELI" },
  sell: { bg: "rgba(239,83,80,0.12)",   border: "rgba(239,83,80,0.3)",   color: "var(--red)",   icon: "▼ JUAL" },
  warn: { bg: "rgba(255,160,0,0.10)",   border: "rgba(255,160,0,0.3)",   color: "var(--amber)", icon: "⚠" },
  info: { bg: "rgba(139,147,167,0.08)", border: "rgba(139,147,167,0.2)", color: "var(--muted)", icon: "→" },
};

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
  const { entryThreshold: entry, exitThreshold: exit, stopThreshold: stop } = thresholds;
  const max = Math.max(stop + 0.5, Math.abs(z) + 0.5);
  const v = verdictFor(z, thresholds, symbolA, symbolB);
  const pos = zToPct(z, max);
  const mark = (zVal: number) => `${zToPct(zVal, max)}%`;

  return (
    <div>
      {/* ── Verdict banner ────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 18px",
          borderRadius: 10,
          background: "var(--panel-2)",
          border: `1px solid ${v.color}`,
          borderLeft: `5px solid ${v.color}`,
          marginBottom: 16,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.8,
              color: v.color,
              background: `${v.color}22`,
              padding: "3px 10px",
              borderRadius: 20,
              border: `1px solid ${v.color}44`,
            }}
          >
            {v.badge}
          </span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", marginBottom: 4 }}>
          {v.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          {v.detail}
        </div>
      </div>

      {/* ── Action steps ──────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: "var(--muted)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Langkah selanjutnya
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {v.steps.map((step, i) => {
            const s = STEP_STYLE[step.highlight];
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  borderRadius: 8,
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    color: s.color,
                    fontWeight: 800,
                    fontSize: 11,
                    width: 40,
                    flexShrink: 0,
                    letterSpacing: 0.5,
                  }}
                >
                  {s.icon}
                </span>
                <span style={{ color: "var(--text)", fontFamily: "monospace", letterSpacing: 0.3 }}>
                  {step.text}
                </span>
              </div>
            );
          })}
        </div>

        {v.alertText && (
          <div
            style={{
              marginTop: 8,
              padding: "9px 14px",
              borderRadius: 8,
              background: "rgba(255,160,0,0.08)",
              border: "1px dashed rgba(255,160,0,0.4)",
              fontSize: 13,
              color: "var(--amber)",
            }}
          >
            💡 {v.alertText}
          </div>
        )}
      </div>

      {/* ── Gauge ─────────────────────────────────────────────── */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "var(--muted)",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Posisi z-score sekarang
      </div>
      <div style={{ position: "relative", height: 48, marginBottom: 40, marginTop: 32 }}>
        {/* Colored zones with inline labels */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 8,
            overflow: "hidden",
            display: "flex",
          }}
        >
          <ZoneBlock w={mark(-stop)} bg="rgba(239,83,80,0.35)" label="STOP" labelColor="rgba(239,83,80,0.9)" />
          <ZoneBlock
            w={`calc(${mark(-entry)} - ${mark(-stop)})`}
            bg="rgba(38,166,154,0.30)"
            label="LONG"
            labelColor="rgba(38,166,154,0.95)"
          />
          <ZoneBlock w={`calc(${mark(-exit)} - ${mark(-entry)})`} bg="rgba(255,160,0,0.06)" />
          <ZoneBlock
            w={`calc(${mark(exit)} - ${mark(-exit)})`}
            bg="rgba(139,147,167,0.22)"
            label="TUTUP"
            labelColor="var(--muted)"
          />
          <ZoneBlock w={`calc(${mark(entry)} - ${mark(exit)})`} bg="rgba(255,160,0,0.06)" />
          <ZoneBlock
            w={`calc(${mark(stop)} - ${mark(entry)})`}
            bg="rgba(239,83,80,0.30)"
            label="SHORT"
            labelColor="rgba(239,83,80,0.95)"
          />
          <ZoneBlock flex bg="rgba(239,83,80,0.35)" label="STOP" labelColor="rgba(239,83,80,0.9)" />
        </div>

        {/* Current z marker */}
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
            boxShadow: `0 0 10px ${v.color}`,
          }}
        />
        {/* z value bubble */}
        <div
          style={{
            position: "absolute",
            left: `${pos}%`,
            top: -30,
            transform: "translateX(-50%)",
            fontSize: 13,
            fontWeight: 800,
            color: v.color,
            whiteSpace: "nowrap",
            background: "var(--panel)",
            padding: "2px 8px",
            borderRadius: 5,
            border: `1px solid ${v.color}`,
          }}
        >
          z = {z.toFixed(2)}
        </div>

        {/* Tick labels */}
        {[
          { zv: -stop, label: `−${stop}` },
          { zv: -entry, label: `−${entry}` },
          { zv: 0, label: "0" },
          { zv: entry, label: `+${entry}` },
          { zv: stop, label: `+${stop}` },
        ].map((tk) => (
          <div
            key={tk.label}
            style={{
              position: "absolute",
              left: mark(tk.zv),
              bottom: -24,
              transform: "translateX(-50%)",
              fontSize: 11,
              color: "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            {tk.label}
          </div>
        ))}
      </div>

      {/* ── Quick-reference legend ────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
        {[
          {
            color: "var(--green)",
            label: `LONG  (z < −${entry})`,
            desc: `Beli ${symbolA} · Jual ${symbolB}`,
          },
          {
            color: "var(--red)",
            label: `SHORT (z > +${entry})`,
            desc: `Jual ${symbolA} · Beli ${symbolB}`,
          },
          {
            color: "var(--muted)",
            label: `TUTUP (|z| < ${exit})`,
            desc: "Tutup posisi, ambil profit",
          },
          {
            color: "var(--red)",
            label: `STOP  (|z| > ${stop})`,
            desc: "Cut loss / jangan masuk",
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "7px 10px",
              background: "var(--panel-2)",
              borderRadius: 7,
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ color: item.color, fontSize: 16, lineHeight: 1.1, flexShrink: 0 }}>■</span>
            <div>
              <div style={{ color: item.color, fontWeight: 700, fontSize: 12 }}>{item.label}</div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ZoneBlock({
  w,
  flex,
  bg,
  label,
  labelColor,
}: {
  w?: string;
  flex?: boolean;
  bg: string;
  label?: string;
  labelColor?: string;
}) {
  return (
    <div
      style={{
        ...(flex ? { flex: 1 } : { width: w }),
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label && (
        <span style={{ fontSize: 10, fontWeight: 800, color: labelColor, letterSpacing: 0.5 }}>
          {label}
        </span>
      )}
    </div>
  );
}
