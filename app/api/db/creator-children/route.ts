import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";
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
    issuedAssets: r.issued_assets ? JSON.parse(r.issued_assets as string) : undefined,
    distributedAssets: r.distributed_assets ? JSON.parse(r.distributed_assets as string) : undefined,
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
    let query = sb.from("creator_children").select("*").eq("user_id", userId!);
    if (creator) {
      query = query.eq("creator_address", creator).eq("network", network);
    }
    const { data } = await query.order("discovered_at", { ascending: false });
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

  const body = await req.json();
  const items: CreatorChild[] = Array.isArray(body) ? body : [body];

  if (!isSupabaseOnly()) {
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
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    for (const c of items) {
      await sb.from("creator_children").upsert({
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
    }
  });

  return NextResponse.json({ ok: true, count: items.length });
}

// DELETE — remove one child by id, or all children for a creator
// Body: { id: string } | { creatorAddress: string, network: string }
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const body = await req.json();

  if (!isSupabaseOnly()) {
    const db = getDb();
    if (body.id) {
      db.prepare("DELETE FROM creator_children WHERE id = ?").run(body.id);
    } else if (body.creatorAddress) {
      db.prepare("DELETE FROM creator_children WHERE creator_address = ? AND network = ?")
        .run(body.creatorAddress, body.network ?? "public");
    }
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    if (body.id) {
      await sb.from("creator_children").delete().eq("user_id", userId!).eq("id", body.id);
    } else if (body.creatorAddress) {
      await sb.from("creator_children").delete()
        .eq("user_id", userId!)
        .eq("creator_address", body.creatorAddress)
        .eq("network", body.network ?? "public");
    }
  });

  return NextResponse.json({ ok: true });
}
