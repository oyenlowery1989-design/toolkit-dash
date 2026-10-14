import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import type { WatchlistEntry } from "@/lib/tracer-v2/types";

// Tracer v2 Watchlist — local-only feature. The poller (lib/tracer-v2/watcher.ts)
// only runs on a persistent Node process, which doesn't exist on Vercel serverless.
// So unlike other DB-backed modules, this one does NOT dual-write to Supabase —
// when isSupabaseOnly() is true the feature is disabled.

function mapRow(r: Record<string, unknown>): WatchlistEntry {
  return {
    id: r.id as string,
    address: r.address as string,
    label: (r.label as string) ?? "",
    network: "public",
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
  if (typeof b.address !== "string" || !StrKey.isValidEd25519PublicKey(b.address.trim())) {
    return NextResponse.json({ error: "Valid Stellar address required" }, { status: 400 });
  }

  if (isSupabaseOnly()) return NextResponse.json({ error: "Watchlist is unavailable in this deployment" }, { status: 503 });

  const id = b.id ?? crypto.randomUUID();
  const now = Date.now();
  const db = getDb();
  const address = b.address.trim();
  const duplicate = db.prepare("SELECT id FROM tracer_watchlist WHERE address = ? AND network = 'public' AND id != ?")
    .get(address, id);
  if (duplicate) return NextResponse.json({ error: "Address is already watched" }, { status: 409 });
  db
    .prepare(
      `INSERT INTO tracer_watchlist (id, address, label, network, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         address = excluded.address,
         label   = excluded.label,
         network = excluded.network,
         enabled = excluded.enabled`,
    )
    .run(id, address, b.label ?? "", "public", b.enabled === false ? 0 : 1, now);

  return NextResponse.json({ ok: true, id });
}

// PATCH — partial update. Body: { id, label?, enabled?, pollCursor?, lastCheckedAt? }
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (isSupabaseOnly()) return NextResponse.json({ error: "Watchlist is unavailable in this deployment" }, { status: 503 });

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

  if (isSupabaseOnly()) return NextResponse.json({ error: "Watchlist is unavailable in this deployment" }, { status: 503 });

  const db = getDb();
  db.prepare("DELETE FROM tracer_watch_events WHERE watch_id = ?").run(key);
  db.prepare("DELETE FROM tracer_watchlist WHERE id = ?").run(key);

  return NextResponse.json({ ok: true });
}
