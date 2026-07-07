import { NextRequest, NextResponse } from "next/server";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";

// Mirrors app/api/auto-send/scheduler-status/route.ts's pattern, but checks
// the actual condition that disables tracer-watchlist persistence (see the
// no-op guards in app/api/db/tracer-watchlist/route.ts and
// tracer-watch-events/route.ts) rather than raw process.env.VERCEL.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ disabled: isSupabaseOnly() });
}
