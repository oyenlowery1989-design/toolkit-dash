import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

function mapRow(r: Record<string, unknown>) {
  return {
    publicKey: r.public_key,
    label: r.label,
    notes: r.notes ?? undefined,
    color: r.color ?? undefined,
    timestamp: r.created_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!
      .from("address_book")
      .select("*")
      .eq("user_id", userId!)
      .order("created_at", { ascending: false });
    if (error) console.error("[address-book] supabase error:", error);
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM address_book ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.publicKey || !StrKey.isValidEd25519PublicKey(b.publicKey)) {
    return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
  }
  const now = b.timestamp ?? Date.now();

  if (!isSupabaseOnly()) {
    getDb()
      .prepare(
        `INSERT INTO address_book (public_key, label, notes, color, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(public_key) DO UPDATE SET
           label = excluded.label,
           notes = excluded.notes,
           color = excluded.color`,
      )
      .run(b.publicKey, b.label, b.notes ?? null, b.color ?? null, now);
  }

  syncToSupabase(() =>
    getSupabase()!.from("address_book").upsert(
      {
        user_id: userId,
        public_key: b.publicKey,
        label: b.label,
        notes: b.notes ?? null,
        color: b.color ?? null,
        created_at: now,
      },
      { onConflict: "user_id,public_key" },
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
    getDb().prepare("DELETE FROM address_book WHERE public_key = ?").run(key);
  }

  syncToSupabase(() =>
    getSupabase()!.from("address_book").delete().eq("user_id", userId!).eq("public_key", key),
  );

  return NextResponse.json({ ok: true });
}
