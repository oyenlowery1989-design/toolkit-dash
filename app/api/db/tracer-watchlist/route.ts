import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import type { WatchlistEntry } from "@/lib/tracer-v2/types";

// Tracer v2 Watchlist — local-only feature. The poller (lib/tracer-v2/watcher.ts)
// only runs on a persistent Node process, which doesn't exist on Vercel serverless.
// So unlike other DB-backed modules, this one does NOT dual-write to Supabase —
// when isSupabaseOnly() is true the feature is simply disabled (GET -> [], writes -> no-op).

function mapRow(r: Record<string, unknown>): WatchlistEntry {
  return {
    id: r.id as string,
    address: r.address as string,
    label: (r.label as string) ?? "",
    network: (r.network as string) ?? "public",
    enabled: (r.enabled as number) === 1,
    pollCursor: (r.poll_cursor as string | null) ?? undefined,
    lastCheckedAt: (r.last_checked_at as number | null) ?? undefined,
    createdAt: r.created_at as number,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) return NextResponse.json([]);

  const rows = getDb()
    .prepare("SELECT * FROM tracer_watchlist ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

// POST — create or update a watch entry.
// Body: { id?, address, label?, network?, enabled? }
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.address || typeof b.address !== "string") {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  const id = b.id ?? crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO tracer_watchlist (id, address, label, network, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         address = excluded.address,
         label   = excluded.label,
         network = excluded.network,
         enabled = excluded.enabled`,
    )
    .run(id, b.address, b.label ?? "", b.network ?? "public", b.enabled === false ? 0 : 1, now);

  return NextResponse.json({ ok: true, id });
}

// PATCH — partial update. Body: { id, label?, enabled?, pollCursor?, lastCheckedAt? }
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  const fields: string[] = [];
  const values: unknown[] = [];
  if (b.label !== undefined) { fields.push("label = ?"); values.push(b.label); }
  if (b.enabled !== undefined) { fields.push("enabled = ?"); values.push(b.enabled ? 1 : 0); }
  if (b.pollCursor !== undefined) { fields.push("poll_cursor = ?"); values.push(b.pollCursor); }
  if (b.lastCheckedAt !== undefined) { fields.push("last_checked_at = ?"); values.push(b.lastCheckedAt); }
  if (fields.length === 0) return NextResponse.json({ ok: true });

  values.push(b.id);
  getDb().prepare(`UPDATE tracer_watchlist SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  return NextResponse.json({ ok: true });
}

// DELETE — Body: { key: id } — removes the watch and its events.
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let key: string;
  try { ({ key } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) return NextResponse.json({ ok: true });

  const db = getDb();
  db.prepare("DELETE FROM tracer_watch_events WHERE watch_id = ?").run(key);
  db.prepare("DELETE FROM tracer_watchlist WHERE id = ?").run(key);

  return NextResponse.json({ ok: true });
}
