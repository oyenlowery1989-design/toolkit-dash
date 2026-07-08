import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

const MAX = 30;

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    assetCode: r.asset_code,
    issuer: r.issuer,
    distributionAddress: r.distribution_address,
    network: r.network,
    accountsText: r.accounts_text,
    createdAt: r.created_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("proceeds_presets")
      .select("*")
      .eq("user_id", userId!)
      .order("created_at", { ascending: false })
      .limit(MAX);
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM proceeds_presets ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = b.createdAt ?? Date.now();

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { error: upsertError } = await sb.from("proceeds_presets").upsert({
      id: b.id,
      user_id: userId,
      asset_code: b.assetCode,
      issuer: b.issuer,
      distribution_address: b.distributionAddress,
      network: b.network,
      accounts_text: b.accountsText,
      created_at: now,
    });
    if (upsertError) {
      console.error("[proceeds-presets] POST failed:", upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
    const { data: oldest } = await sb
      .from("proceeds_presets")
      .select("id")
      .eq("user_id", userId!)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (oldest && oldest.length > MAX) {
      const toDelete = oldest.slice(0, oldest.length - MAX).map((r) => r.id);
      await sb.from("proceeds_presets").delete().in("id", toDelete).eq("user_id", userId!);
    }
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO proceeds_presets (id, asset_code, issuer, distribution_address, network, accounts_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       accounts_text = excluded.accounts_text,
       created_at = excluded.created_at`,
  ).run(b.id, b.assetCode, b.issuer, b.distributionAddress, b.network, b.accountsText, now);
  db.prepare(
    `DELETE FROM proceeds_presets WHERE id NOT IN
     (SELECT id FROM proceeds_presets ORDER BY created_at DESC LIMIT ?)`,
  ).run(MAX);

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    await sb.from("proceeds_presets").upsert({
      id: b.id,
      user_id: userId,
      asset_code: b.assetCode,
      issuer: b.issuer,
      distribution_address: b.distributionAddress,
      network: b.network,
      accounts_text: b.accountsText,
      created_at: now,
    });
    const { data: oldest } = await sb
      .from("proceeds_presets")
      .select("id")
      .eq("user_id", userId!)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (oldest && oldest.length > MAX) {
      const toDelete = oldest.slice(0, oldest.length - MAX).map((r) => r.id);
      await sb.from("proceeds_presets").delete().in("id", toDelete).eq("user_id", userId!);
    }
  });

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
      .from("proceeds_presets")
      .delete()
      .eq("id", key)
      .eq("user_id", userId!);
    if (error) {
      console.error("[proceeds-presets] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb().prepare("DELETE FROM proceeds_presets WHERE id = ?").run(key);
  syncToSupabase(() =>
    getSupabase()!.from("proceeds_presets").delete().eq("id", key).eq("user_id", userId!),
  );

  return NextResponse.json({ ok: true });
}
