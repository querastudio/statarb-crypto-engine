// Cron authorization helper. Vercel Cron sends "Authorization: Bearer
// $CRON_SECRET". If CRON_SECRET is unset we allow the call (dev convenience),
// but warn-by-design: always set CRON_SECRET in production.

import { NextRequest } from "next/server";

export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured → allow (local/dev)
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}
