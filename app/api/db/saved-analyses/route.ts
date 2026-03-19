import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

const MAX = 50;

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    assetCode: r.asset_code,
    issuer: r.issuer,
    distribAddresses: typeof r.distrib_addresses === "string"
      ? JSON.parse(r.distrib_addresses)
      : r.distrib_addresses,
    network: r.network,
    result: typeof r.result_json === "string"
      ? JSON.parse(r.result_json)
      : r.result_json,
    notes: r.notes ?? undefined,
    tags: r.tags
      ? typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags
      : undefined,
    timestamp: r.created_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("saved_analyses")
      .select("*")
      .eq("user_id", userId!)
      .order("created_at", { ascending: false })
      .limit(MAX);
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM saved_analyses ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const b = await req.json();
  const now = b.timestamp ?? Date.now();

  if (!isSupabaseOnly()) {
    const db = getDb();
    db.prepare(
      `INSERT INTO saved_analyses
         (id, name, asset_code, issuer, distrib_addresses, network, result_json, notes, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         notes = excluded.notes,
         tags  = excluded.tags`,
    ).run(
      b.id, b.name, b.assetCode, b.issuer,
      JSON.stringify(b.distribAddresses ?? []),
      b.network, JSON.stringify(b.result),
      b.notes ?? null,
      b.tags ? JSON.stringify(b.tags) : null,
      now,
    );
    // Trim to MAX
    db.prepare(
      `DELETE FROM saved_analyses WHERE id NOT IN
       (SELECT id FROM saved_analyses ORDER BY created_at DESC LIMIT ?)`,
    ).run(MAX);
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    await sb.from("saved_analyses").upsert({
      id: b.id,
      user_id: userId,
      name: b.name,
      asset_code: b.assetCode,
      issuer: b.issuer,
      distrib_addresses: b.distribAddresses ?? [],
      network: b.network,
      result_json: b.result,
      notes: b.notes ?? null,
      tags: b.tags ?? null,
      created_at: now,
    });
    // Trim to MAX on Supabase side
    const { data: oldest } = await sb
      .from("saved_analyses")
      .select("id")
      .eq("user_id", userId!)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (oldest && oldest.length > MAX) {
      const toDelete = oldest.slice(0, oldest.length - MAX).map((r) => r.id);
      await sb.from("saved_analyses").delete().in("id", toDelete).eq("user_id", userId!);
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const { key } = await req.json();

  if (!isSupabaseOnly()) {
    getDb().prepare("DELETE FROM saved_analyses WHERE id = ?").run(key);
  }

  syncToSupabase(() =>
    getSupabase()!.from("saved_analyses").delete().eq("id", key).eq("user_id", userId!),
  );

  return NextResponse.json({ ok: true });
}

// PATCH used for name/notes/tags-only updates
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const { id, name, notes, tags } = await req.json();

  if (!isSupabaseOnly()) {
    const db = getDb();
    if (name !== undefined) db.prepare("UPDATE saved_analyses SET name = ? WHERE id = ?").run(name, id);
    if (notes !== undefined) db.prepare("UPDATE saved_analyses SET notes = ? WHERE id = ?").run(notes, id);
    if (tags !== undefined) db.prepare("UPDATE saved_analyses SET tags = ? WHERE id = ?").run(JSON.stringify(tags), id);
  }

  syncToSupabase(async () => {
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (notes !== undefined) patch.notes = notes;
    if (tags !== undefined) patch.tags = tags;
    if (Object.keys(patch).length > 0) {
      await getSupabase()!.from("saved_analyses").update(patch).eq("id", id).eq("user_id", userId!);
    }
  });

  return NextResponse.json({ ok: true });
}
