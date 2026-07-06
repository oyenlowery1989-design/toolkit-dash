import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import type { WatchEvent } from "@/lib/tracer-v2/types";

// Tracer v2 Watchlist events — local-only, same rationale as tracer-watchlist/route.ts:
// the poller only runs on a persistent Node process, so Supabase-only deployments
// simply disable the feature (GET -> [], writes -> no-op).

function mapRow(r: Record<string, unknown>): WatchEvent {
  return {
    id: r.id as string,
    watchId: r.watch_id as string,
    eventType: (r.event_type as string) ?? "create_account",
    accountCreated: r.account_created as string,
    funder: (r.funder as string | null) ?? undefined,
    amount: (r.amount as string | null) ?? undefined,
    txHash: (r.tx_hash as string | null) ?? undefined,
    ledgerTime: (r.ledger_time as string | null) ?? undefined,
    seen: (r.seen as number) === 1,
    createdAt: r.created_at as number,
  };
}

// GET ?watchId= (optional)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) return NextResponse.json([]);

  const watchId = req.nextUrl.searchParams.get("watchId");
  const db = getDb();
  const rows = watchId
    ? (db
        .prepare("SELECT * FROM tracer_watch_events WHERE watch_id = ? ORDER BY created_at DESC LIMIT 500")
        .all(watchId) as Record<string, unknown>[])
    : (db
        .prepare("SELECT * FROM tracer_watch_events ORDER BY created_at DESC LIMIT 500")
        .all() as Record<string, unknown>[]);
  return NextResponse.json(rows.map(mapRow));
}

// POST — insert an event (used by the poller and by manual tests).
// Body: { id?, watchId, eventType?, accountCreated, funder?, amount?, txHash?, ledgerTime?, seen?, createdAt? }
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.watchId || !b.accountCreated) {
    return NextResponse.json({ error: "watchId and accountCreated required" }, { status: 400 });
  }

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  const id = b.id ?? crypto.randomUUID();
  const now = b.createdAt ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO tracer_watch_events
        (id, watch_id, event_type, account_created, funder, amount, tx_hash, ledger_time, seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      b.watchId,
      b.eventType ?? "create_account",
      b.accountCreated,
      b.funder ?? null,
      b.amount ?? null,
      b.txHash ?? null,
      b.ledgerTime ?? null,
      b.seen ? 1 : 0,
      now,
    );

  return NextResponse.json({ ok: true, id });
}

// PATCH — mark seen. Body: { id } marks one event seen, { markAllSeen: true } marks all.
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  const db = getDb();
  if (b.markAllSeen) {
    db.prepare("UPDATE tracer_watch_events SET seen = 1 WHERE seen = 0").run();
  } else if (b.id) {
    db.prepare("UPDATE tracer_watch_events SET seen = 1 WHERE id = ?").run(b.id);
  } else {
    return NextResponse.json({ error: "id or markAllSeen required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE — Body: { key: id }
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let key: string;
  try { ({ key } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  getDb().prepare("DELETE FROM tracer_watch_events WHERE id = ?").run(key);

  return NextResponse.json({ ok: true });
}
