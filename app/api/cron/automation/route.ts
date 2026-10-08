import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueAutoSend } from "@/lib/auto-send/scheduler";
import { runDueTieredRewards } from "@/lib/tiered-rewards/scheduler";

export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "External scheduler is not configured" }, { status: 503 });
  const actual = Buffer.from(req.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await runDueAutoSend();
    await runDueTieredRewards();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Scheduler tick failed; check server logs" }, { status: 500 });
  }
}
