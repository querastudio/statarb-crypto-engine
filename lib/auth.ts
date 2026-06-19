// Cron authorization helper. Vercel Cron / GitHub Actions send
// "Authorization: Bearer $CRON_SECRET". For manual checks from a browser we
// also accept "?secret=$CRON_SECRET" (same pattern as the demo route). If
// CRON_SECRET is unset we allow the call (dev convenience), but warn-by-design:
// always set CRON_SECRET in production.

import { NextRequest } from "next/server";

export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured → allow (local/dev)
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  // Browser-friendly fallback: ?secret=… query param.
  return req.nextUrl.searchParams.get("secret") === secret;
}
