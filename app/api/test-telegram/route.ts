import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Diagnostic endpoint for Telegram setup.
 *
 * Two jobs:
 *   1. Tell you exactly which piece of config is missing / wrong.
 *   2. Help you DISCOVER your chat ID — send any message to your bot, then
 *      open this endpoint; it reads getUpdates and lists every chat ID that
 *      has messaged the bot. No @userinfobot needed.
 *
 * Protected by CRON_SECRET (so the token is never exposed publicly):
 *   GET /api/test-telegram?secret=YOUR_CRON_SECRET
 *
 * Add &send=1 to actually fire a test message to the configured chat ID.
 */
export async function GET(req: NextRequest) {
  // ── Auth: require the cron secret as a query param (browser-friendly) ──────
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("secret");
  if (secret && provided !== secret) {
    return NextResponse.json(
      { ok: false, error: "unauthorized — tambahkan ?secret=CRON_SECRET di URL" },
      { status: 401 },
    );
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const checklist = {
    TELEGRAM_ALERT_is_yes: config.telegramEnabled,
    TELEGRAM_BOT_TOKEN_set: Boolean(token),
    TELEGRAM_CHAT_ID_set: Boolean(chatId),
  };

  // ── Token missing → can't do anything ──────────────────────────────────────
  if (!token) {
    return NextResponse.json({
      ok: false,
      checklist,
      hint: "TELEGRAM_BOT_TOKEN belum di-set di Vercel. Buat bot via @BotFather, lalu isi env var-nya dan redeploy.",
    });
  }

  // ── Verify the token is valid via getMe ────────────────────────────────────
  let botUsername: string | null = null;
  try {
    const meRes = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    const me = await meRes.json();
    if (!me.ok) {
      return NextResponse.json({
        ok: false,
        checklist,
        hint: "TELEGRAM_BOT_TOKEN salah/tidak valid. Cek lagi token dari @BotFather.",
        telegramError: me.description,
      });
    }
    botUsername = me.result?.username ?? null;
  } catch (e) {
    return NextResponse.json({
      ok: false,
      checklist,
      hint: "Gagal menghubungi Telegram API.",
      error: (e as Error).message,
    });
  }

  // ── Discover chat IDs from getUpdates (the "cara lain") ─────────────────────
  // Anyone who has sent the bot a message shows up here with their chat ID.
  const discoveredChats: { id: number; name: string; type: string }[] = [];
  try {
    const upRes = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates`);
    const up = await upRes.json();
    if (up.ok && Array.isArray(up.result)) {
      const seen = new Set<number>();
      for (const update of up.result) {
        const chat =
          update.message?.chat ??
          update.channel_post?.chat ??
          update.my_chat_member?.chat;
        if (chat && !seen.has(chat.id)) {
          seen.add(chat.id);
          const name =
            chat.title ??
            [chat.first_name, chat.last_name].filter(Boolean).join(" ") ??
            chat.username ??
            "(tanpa nama)";
          discoveredChats.push({ id: chat.id, name, type: chat.type });
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  // ── Optionally send a real test message ────────────────────────────────────
  let testMessage: Record<string, unknown> | null = null;
  if (req.nextUrl.searchParams.get("send") === "1") {
    if (!chatId) {
      testMessage = { sent: false, reason: "TELEGRAM_CHAT_ID belum di-set." };
    } else {
      try {
        const sendRes = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "✅ Test berhasil! Notifikasi StatArb sudah aktif.",
          }),
        });
        const sendJson = await sendRes.json();
        testMessage = sendJson.ok
          ? { sent: true }
          : { sent: false, telegramError: sendJson.description };
      } catch (e) {
        testMessage = { sent: false, error: (e as Error).message };
      }
    }
  }

  // ── Build a human next-step hint ────────────────────────────────────────────
  let hint: string;
  if (!chatId && discoveredChats.length > 0) {
    hint =
      `Bot OK (@${botUsername}). Ditemukan ${discoveredChats.length} chat di bawah. ` +
      `Salin angka "id" → isi sebagai TELEGRAM_CHAT_ID di Vercel → redeploy.`;
  } else if (!chatId) {
    hint =
      `Bot OK (@${botUsername}), tapi belum ada chat. Buka Telegram, cari @${botUsername}, ` +
      `tekan Start / kirim "halo", lalu refresh halaman ini untuk melihat chat ID-mu.`;
  } else if (!config.telegramEnabled) {
    hint = "Token & chat ID OK, tapi TELEGRAM_ALERT belum 'yes'. Set TELEGRAM_ALERT=yes lalu redeploy.";
  } else {
    hint = "Semua terkonfigurasi ✓. Tambahkan &send=1 di URL untuk kirim pesan test.";
  }

  return NextResponse.json({
    ok: true,
    bot: botUsername ? `@${botUsername}` : null,
    checklist,
    discoveredChats,
    testMessage,
    hint,
  });
}
