import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

const MAX = 30;

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    type: r.type,
    value: r.value,
    label: r.label ?? undefined,
    network: r.network ?? undefined,
    distribAddress: r.distrib_address ?? undefined,
    totalXlmProceeds: r.total_xlm_proceeds ?? undefined,
    totalAssetSold: r.total_asset_sold ?? undefined,
    intermediaryName: r.intermediary_name ?? undefined,
    accountsFound: r.accounts_found ?? undefined,
    timestamp: r.created_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("saved_searches")
      .select("*")
      .eq("user_id", userId!)
      .order("created_at", { ascending: false })
      .limit(MAX);
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM saved_searches ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = b.timestamp ?? Date.now();

  if (isSupabaseOnly()) {
    // Supabase IS the primary store here — await it and surface real
    // failures, instead of the fire-and-forget syncToSupabase() helper
    // (that helper is only correct for the local dual-write backup path
    // below, where SQLite already succeeded and Supabase is best-effort).
    const sb = getSupabase()!;
    const { error: upsertError } = await sb.from("saved_searches").upsert(
      {
        user_id: userId,
        type: b.type,
        value: b.value,
        label: b.label ?? null,
        network: b.network ?? null,
        distrib_address: b.distribAddress ?? null,
        total_xlm_proceeds: b.totalXlmProceeds ?? null,
        total_asset_sold: b.totalAssetSold ?? null,
        intermediary_name: b.intermediaryName ?? null,
        accounts_found: b.accountsFound ?? null,
        created_at: now,
      },
      { onConflict: "user_id,type,value" },
    );
    if (upsertError) {
      console.error("[saved-searches] POST failed:", upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
    // Trim to MAX on Supabase side
    const { data: oldest } = await sb
      .from("saved_searches")
      .select("id")
      .eq("user_id", userId!)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (oldest && oldest.length > MAX) {
      const toDelete = oldest.slice(0, oldest.length - MAX).map((r) => r.id);
      await sb.from("saved_searches").delete().in("id", toDelete).eq("user_id", userId!);
    }
    return NextResponse.json({ ok: true });
  }

  return getDb().transaction(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO saved_searches
         (type, value, label, network, distrib_address, total_xlm_proceeds,
          total_asset_sold, intermediary_name, accounts_found, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(type, value) DO UPDATE SET
         label              = excluded.label,
         network            = excluded.network,
         distrib_address    = excluded.distrib_address,
         total_xlm_proceeds = excluded.total_xlm_proceeds,
         total_asset_sold   = excluded.total_asset_sold,
         intermediary_name  = excluded.intermediary_name,
         accounts_found     = excluded.accounts_found,
         created_at         = excluded.created_at`,
    ).run(
      b.type, b.value, b.label ?? null, b.network ?? null,
      b.distribAddress ?? null, b.totalXlmProceeds ?? null,
      b.totalAssetSold ?? null, b.intermediaryName ?? null,
      b.accountsFound ?? null, now,
    );
    db.prepare(
      `DELETE FROM saved_searches WHERE id NOT IN
       (SELECT id FROM saved_searches ORDER BY created_at DESC LIMIT ?)`,
    ).run(MAX);

    syncToSupabase([
      {
        table: 'saved_searches', action: 'upsert', onConflict: 'user_id,type,value', data: {
          user_id: userId, type: b.type, value: b.value, label: b.label ?? null, network: b.network ?? null,
          distrib_address: b.distribAddress ?? null, total_xlm_proceeds: b.totalXlmProceeds ?? null,
          total_asset_sold: b.totalAssetSold ?? null, intermediary_name: b.intermediaryName ?? null,
          accounts_found: b.accountsFound ?? null, created_at: now,
        }
      },
      { table: 'saved_searches', action: 'trim', keep: MAX, orderColumn: 'created_at' },
    ]);

    return NextResponse.json({ ok: true });
  })();
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let key: any, id: any;
  try { ({ key, id } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  // id = row id (preferred); key = created_at fallback for pre-id clients

  if (isSupabaseOnly()) {
    const { error } = id !== undefined && id !== null
      ? await getSupabase()!.from("saved_searches").delete().eq("id", id).eq("user_id", userId!)
      : await getSupabase()!.from("saved_searches").delete().eq("created_at", key).eq("user_id", userId!);
    if (error) {
      console.error("[saved-searches] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return getDb().transaction(() => {
    const db = getDb();
    const rows = id !== undefined && id !== null
      ? db.prepare("SELECT type, value FROM saved_searches WHERE id = ?").all(id)
      : db.prepare("SELECT type, value FROM saved_searches WHERE created_at = ?").all(key);
    if (id !== undefined && id !== null) db.prepare("DELETE FROM saved_searches WHERE id = ?").run(id);
    else db.prepare("DELETE FROM saved_searches WHERE created_at = ?").run(key);
    if (rows.length) syncToSupabase((rows as { type: string; value: string; }[]).map((row) => ({
      table: "saved_searches", action: "delete", match: { type: row.type, value: row.value, user_id: userId },
    })));
    return NextResponse.json({ ok: true });
  })();
}
