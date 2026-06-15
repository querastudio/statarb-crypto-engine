// Telegram alerting. No-op (returns false) when disabled or unconfigured.

import { config } from "@/lib/config";
import type { Signal } from "@/lib/types";

const TELEGRAM_API = "https://api.telegram.org";

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

/** Send a raw message. Returns true on success. */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!config.telegramEnabled) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const SIDE_LABEL: Record<string, string> = {
  LONG_SPREAD: "🟢 LONG spread (long A / short B)",
  SHORT_SPREAD: "🔴 SHORT spread (short A / long B)",
  CLOSE: "⚪ CLOSE position",
  STOP: "🛑 STOP LOSS",
  FLAT: "· no action",
};

/** Format and send a signal alert. */
export async function alertSignal(signal: Signal): Promise<boolean> {
  const label = SIDE_LABEL[signal.side] ?? signal.side;
  const lines = [
    `*StatArb signal* — \`${signal.symbol_a}\` / \`${signal.symbol_b}\``,
    label,
    `z-score: *${fmt(signal.zscore)}*`,
    `beta: ${fmt(signal.beta, 4)}  |  spread: ${fmt(signal.spread, 4)}`,
    `price A: ${fmt(signal.price_a, 4)}  |  price B: ${fmt(signal.price_b, 4)}`,
    signal.note ? `_${signal.note}_` : "",
  ].filter(Boolean);
  return sendTelegramMessage(lines.join("\n"));
}

/** Only entry/exit/stop transitions are worth alerting on. */
export function isAlertable(side: string): boolean {
  return side === "LONG_SPREAD" || side === "SHORT_SPREAD" || side === "CLOSE" || side === "STOP";
}
