import { readPages } from "@/lib/supabase-read-all";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkSupabaseRowOwnership, getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";
import type { CreatorChild } from "@/lib/intermediary-tracer/types";

function mapRow(r: Record<string, unknown>): CreatorChild {
  return {
    id: r.id as string,
    creatorAddress: r.creator_address as string,
    childAddress: r.child_address as string,
    network: r.network as string,
    viaIntermediary: (r.via_intermediary as string | null) ?? undefined,
    createdOnChain: (r.created_on_chain as string | null) ?? undefined,
    confidence: (r.confidence as number | null) ?? undefined,
    startingBalance: (r.starting_balance as number | null) ?? undefined,
    homeDomain: (r.home_domain as string | null) ?? undefined,
    issuedAssets: (typeof r.issued_assets === "string" ? JSON.parse(r.issued_assets) : r.issued_assets) as CreatorChild["issuedAssets"],
    distributedAssets: (typeof r.distributed_assets === "string" ? JSON.parse(r.distributed_assets) : r.distributed_assets) as CreatorChild["distributedAssets"],
    discoveredAt: r.discovered_at as number,
  };
}

// GET /api/db/creator-children?creator=GXXX&network=public
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const creator = req.nextUrl.searchParams.get("creator");
  const network = req.nextUrl.searchParams.get("network") ?? "public";

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data, error } = await readPages((from, to) => {
      let query = sb.from("creator_children").select("*", { count: "exact" }).eq("user_id", userId!);
      if (creator) query = query.eq("creator_address", creator).eq("network", network);
      return query.order("id").range(from, to);
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    data!.sort((a, b) => Number(b.discovered_at) - Number(a.discovered_at));
    return NextResponse.json((data ?? []).map(mapRow));
  }

  const db = getDb();
  if (creator) {
    const rows = db
      .prepare("SELECT * FROM creator_children WHERE creator_address = ? AND network = ? ORDER BY discovered_at DESC")
      .all(creator, network) as Record<string, unknown>[];
    return NextResponse.json(rows.map(mapRow));
  }
  const rows = db
    .prepare("SELECT * FROM creator_children ORDER BY discovered_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

// POST — upsert one or many children
// Body: CreatorChild | CreatorChild[]
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const items: CreatorChild[] = Array.isArray(body) ? body : [body];

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    for (const c of items) {
      const ownership = await checkSupabaseRowOwnership("creator_children", c.id, userId!);
      if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status });
      const { error } = await sb.from("creator_children").upsert({
        user_id: userId,
        id: c.id,
        creator_address: c.creatorAddress,
        child_address: c.childAddress,
        network: c.network,
        via_intermediary: c.viaIntermediary ?? null,
        created_on_chain: c.createdOnChain ?? null,
        confidence: c.confidence ?? null,
        starting_balance: c.startingBalance ?? null,
        home_domain: c.homeDomain ?? null,
        issued_assets: c.issuedAssets ? JSON.stringify(c.issuedAssets) : null,
        distributed_assets: c.distributedAssets ? JSON.stringify(c.distributedAssets) : null,
        discovered_at: c.discoveredAt,
      });
      if (error) {
        console.error("[creator-children] POST failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, count: items.length });
  }

  return getDb().transaction(() => {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO creator_children
      (id, creator_address, child_address, network, via_intermediary, created_on_chain,
       confidence, starting_balance, home_domain, issued_assets, distributed_assets, parent_address, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(creator_address, child_address, network) DO UPDATE SET
      via_intermediary   = COALESCE(excluded.via_intermediary, via_intermediary),
      home_domain        = COALESCE(excluded.home_domain, home_domain),
      issued_assets      = COALESCE(excluded.issued_assets, issued_assets),
      distributed_assets = COALESCE(excluded.distributed_assets, distributed_assets),
      confidence         = COALESCE(excluded.confidence, confidence)
  `);
    const insertMany = db.transaction((rows: CreatorChild[]) => {
      for (const c of rows) {
        stmt.run(
          c.id,
          c.creatorAddress,
          c.childAddress,
          c.network,
          c.viaIntermediary ?? null,
          c.createdOnChain ?? null,
          c.confidence ?? null,
          c.startingBalance ?? null,
          c.homeDomain ?? null,
          c.issuedAssets ? JSON.stringify(c.issuedAssets) : null,
          c.distributedAssets ? JSON.stringify(c.distributedAssets) : null,
          null,
          c.discoveredAt,
        );
      }
    });
    insertMany(items);

    const storedRows = items.map((c) => db.prepare("SELECT * FROM creator_children WHERE creator_address = ? AND child_address = ? AND network = ?")
      .get(c.creatorAddress, c.childAddress, c.network) as Record<string, unknown>);
    syncToSupabase({
      table: "creator_children", action: "upsert", onConflict: "user_id,creator_address,child_address,network", preserveExisting: ["id", "discovered_at"], data: storedRows.map((row) => ({
        ...row, user_id: userId,
        issued_assets: typeof row.issued_assets === "string" ? JSON.parse(row.issued_assets) : row.issued_assets,
        distributed_assets: typeof row.distributed_assets === "string" ? JSON.parse(row.distributed_assets) : row.distributed_assets,
      }))
    });

    return NextResponse.json({ ok: true, count: items.length });
  })();
}

// DELETE — remove one child by id, or all children for a creator
// Body: { id: string } | { creatorAddress: string, network: string }
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    if (body.id) {
      const { error } = await sb.from("creator_children").delete().eq("user_id", userId!).eq("id", body.id);
      if (error) {
        console.error("[creator-children] DELETE failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else if (body.creatorAddress) {
      const { error } = await sb.from("creator_children").delete()
        .eq("user_id", userId!)
        .eq("creator_address", body.creatorAddress)
        .eq("network", body.network ?? "public");
      if (error) {
        console.error("[creator-children] DELETE failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  return getDb().transaction(() => {
    const db = getDb();
    const row = body.id ? db.prepare("SELECT creator_address, child_address, network FROM creator_children WHERE id = ?").get(body.id) as Record<string, unknown> | undefined : undefined;
    if (body.id) db.prepare("DELETE FROM creator_children WHERE id = ?").run(body.id);
    else if (body.creatorAddress) db.prepare("DELETE FROM creator_children WHERE creator_address = ? AND network = ?")
      .run(body.creatorAddress, body.network ?? "public");
    if (row || !body.id && body.creatorAddress) syncToSupabase({
      table: "creator_children", action: "delete", match: row
        ? { ...row, user_id: userId }
        : { user_id: userId, creator_address: body.creatorAddress, network: body.network ?? "public" }
    });

    return NextResponse.json({ ok: true });
  })();
}
