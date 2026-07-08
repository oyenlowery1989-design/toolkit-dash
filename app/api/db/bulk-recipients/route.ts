import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    network: r.network,
    addresses: typeof r.addresses === "string" ? JSON.parse(r.addresses) : r.addresses,
    assetsText: r.assets_text ?? undefined,
    savedAt: r.saved_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("bulk_recipients")
      .select("*")
      .eq("user_id", userId!)
      .order("saved_at", { ascending: false });
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM bulk_recipients ORDER BY saved_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = b.savedAt ?? Date.now();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("bulk_recipients").upsert({
      user_id: userId,
      id: b.id,
      name: b.name,
      network: b.network,
      addresses: b.addresses,
      assets_text: b.assetsText ?? null,
      saved_at: now,
    });
    if (error) {
      console.error("[bulk-recipients] POST failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `INSERT INTO bulk_recipients (id, name, network, addresses, assets_text, saved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         addresses = excluded.addresses,
         assets_text = excluded.assets_text,
         saved_at = excluded.saved_at`,
    )
    .run(b.id, b.name, b.network, JSON.stringify(b.addresses), b.assetsText ?? null, now);

  syncToSupabase(() =>
    getSupabase()!.from("bulk_recipients").upsert({
      user_id: userId,
      id: b.id,
      name: b.name,
      network: b.network,
      addresses: b.addresses,
      assets_text: b.assetsText ?? null,
      saved_at: now,
    }),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let key: string;
  try { ({ key } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!
      .from("bulk_recipients")
      .delete()
      .eq("user_id", userId!)
      .eq("id", key);
    if (error) {
      console.error("[bulk-recipients] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb().prepare("DELETE FROM bulk_recipients WHERE id = ?").run(key);

  syncToSupabase(() =>
    getSupabase()!.from("bulk_recipients").delete().eq("user_id", userId!).eq("id", key),
  );

  return NextResponse.json({ ok: true });
}
