import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

function mapRow(r: Record<string, unknown>) {
  return {
    address: r.address,
    name: r.name,
    notes: r.notes ?? undefined,
    parentAddress: (r.parent_address as string | null) ?? undefined,
    addedAt: r.added_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("known_creators")
      .select("*")
      .eq("user_id", userId!)
      .order("added_at", { ascending: false });
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM known_creators ORDER BY added_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.address || !StrKey.isValidEd25519PublicKey(b.address)) {
    return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
  }
  const now = b.addedAt ?? Date.now();

  if (!isSupabaseOnly()) {
    getDb()
      .prepare(
        `INSERT INTO known_creators (address, name, notes, parent_address, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET
           name = excluded.name,
           notes = excluded.notes,
           parent_address = COALESCE(excluded.parent_address, parent_address)`,
      )
      .run(b.address, b.name, b.notes ?? null, b.parentAddress ?? null, now);
  }

  syncToSupabase(() =>
    getSupabase()!.from("known_creators").upsert(
      {
        user_id: userId,
        address: b.address,
        name: b.name,
        notes: b.notes ?? null,
        parent_address: b.parentAddress ?? null,
        added_at: now,
      },
      { onConflict: "user_id,address" },
    ),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let key: string;
  try { ({ key } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!isSupabaseOnly()) {
    getDb().prepare("DELETE FROM known_creators WHERE address = ?").run(key);
  }

  syncToSupabase(() =>
    getSupabase()!.from("known_creators").delete().eq("user_id", userId!).eq("address", key),
  );

  return NextResponse.json({ ok: true });
}
