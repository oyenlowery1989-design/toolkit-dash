import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { getKeyScanState } from "@/lib/key-scanner/loop";
import type { KeyScanHit } from "@/lib/key-scanner/types";

// Key Scanner — local-only feature, same precedent as tracer-v2 Watchlist
// (app/api/db/tracer-watchlist/route.ts): the loop only runs on a persistent
// Node process, which doesn't exist on Vercel serverless, and hit rows carry
// live secret keys that must never be mirrored to Supabase. So this does NOT
// dual-write — when isSupabaseOnly() is true the feature is simply disabled.

function mapHit(r: Record<string, unknown>): KeyScanHit {
  return {
    id: r.id as string,
    publicKey: r.public_key as string,
    secretKey: r.secret_key as string,
    network: r.network as KeyScanHit["network"],
    xlmBalance: (r.xlm_balance as number | null) ?? null,
    balances: JSON.parse((r.balances_json as string) ?? "[]"),
    sequence: (r.sequence as string | null) ?? null,
    subentryCount: (r.subentry_count as number | null) ?? null,
    foundAt: r.found_at as number,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) {
    return NextResponse.json({ disabled: true, state: null, hits: [] });
  }

  const state = getKeyScanState();
  const hits = getDb()
    .prepare("SELECT * FROM key_scan_hits ORDER BY found_at DESC")
    .all() as Record<string, unknown>[];

  return NextResponse.json({ disabled: false, state, hits: hits.map(mapHit) });
}

// DELETE — Body: { key: id } — purges a single hit row (matches dbDelete's shape).
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let key: string;
  try {
    ({ key } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  getDb().prepare("DELETE FROM key_scan_hits WHERE id = ?").run(key);
  return NextResponse.json({ ok: true });
}
