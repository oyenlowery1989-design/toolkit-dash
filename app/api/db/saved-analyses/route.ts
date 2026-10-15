import { streamJson } from "@/lib/json-stream";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkSupabaseRowOwnership, getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";
import { mapSavedAnalysisRow, summaryPage, SAVED_ANALYSES_PAGE_SIZE } from "@/lib/saved-analyses/server";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("id");
  const timestampInput = req.nextUrl.searchParams.get("beforeTimestamp");
  const beforeId = req.nextUrl.searchParams.get("beforeId");
  const beforeTimestamp = timestampInput === null ? null : Number(timestampInput);
  if ((beforeTimestamp !== null || beforeId !== null) &&
      (beforeTimestamp === null || !timestampInput || !Number.isSafeInteger(beforeTimestamp) || beforeTimestamp < 0 || !beforeId)) {
    return NextResponse.json({ error: "Invalid history cursor" }, { status: 400 });
  }
  if (id) {
    let row: Record<string, unknown> | undefined | null;
    if (isSupabaseOnly()) {
      const { data, error } = await getSupabase()!.from("saved_analyses").select("*").eq("user_id", auth.userId!).eq("id", id).maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      row = data;
    } else row = getDb().prepare("SELECT * FROM saved_analyses WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? streamJson(mapSavedAnalysisRow(row)) : NextResponse.json({ error: "Saved analysis not found" }, { status: 404 });
  }
  let rows: Record<string, unknown>[];
  let total: number | null = null;
  if (isSupabaseOnly()) {
    // Full snapshots contain large ledgers; retry timed-out reads with a smaller batch.
    let batchSize = SAVED_ANALYSES_PAGE_SIZE + 1;
    for (;;) {
      let query = getSupabase()!.from("saved_analyses").select("*", { count: "exact" }).eq("user_id", auth.userId!);
      if (beforeTimestamp !== null) query = query.or(`created_at.lt.${beforeTimestamp},and(created_at.eq.${beforeTimestamp},id.lt.${JSON.stringify(beforeId)})`);
      const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(0, batchSize - 1);
      if (error?.code === "57014" && batchSize > 1) {
        batchSize = Math.max(1, Math.floor(batchSize / 2));
        continue;
      }
      if (error) {
        console.error("[saved-analyses] GET failed:", error.code, error.message);
        return NextResponse.json({ error: "Saved history could not be loaded. Please retry." }, { status: 502 });
      }
      if (count === null) return NextResponse.json({ error: "Saved history row count is unavailable. Please retry." }, { status: 500 });
      rows = data ?? [];
      total = count;
      if (!rows.length && total) return NextResponse.json({ error: "Saved history changed during loading. Please retry." }, { status: 500 });
      break;
    }
  } else rows = beforeTimestamp === null
    ? getDb().prepare("SELECT * FROM saved_analyses ORDER BY created_at DESC, id DESC LIMIT ?").all(SAVED_ANALYSES_PAGE_SIZE + 1) as Record<string, unknown>[]
    : getDb().prepare("SELECT * FROM saved_analyses WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(beforeTimestamp, beforeTimestamp, beforeId, SAVED_ANALYSES_PAGE_SIZE + 1) as Record<string, unknown>[];
  return streamJson(summaryPage(rows.slice(0, SAVED_ANALYSES_PAGE_SIZE), total !== null ? rows.length < total || rows.length > SAVED_ANALYSES_PAGE_SIZE : rows.length > SAVED_ANALYSES_PAGE_SIZE));
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
    if (!b.id || typeof b.id !== "string") {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const ownership = await checkSupabaseRowOwnership("saved_analyses", b.id, userId!);
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    const { error: upsertError } = await sb.from("saved_analyses").upsert({
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
    if (upsertError) {
      console.error("[saved-analyses] POST failed:", upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.transaction(() => {
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
    syncToSupabase({ table: "saved_analyses", action: "upsert", data: {
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
      } });
  })();

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
      .from("saved_analyses")
      .delete()
      .eq("id", key)
      .eq("user_id", userId!);
    if (error) {
      console.error("[saved-analyses] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM saved_analyses WHERE id = ?").run(key);
    syncToSupabase({ table: "saved_analyses", action: "delete", match: { id: key, user_id: userId } });
  })();

  return NextResponse.json({ ok: true });
}

// PATCH used for name/notes/tags-only updates
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let id: string, name: string | undefined, notes: string | undefined, tags: unknown;
  try { ({ id, name, notes, tags } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) {
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (notes !== undefined) patch.notes = notes;
    if (tags !== undefined) patch.tags = tags;
    if (Object.keys(patch).length > 0) {
      const { error } = await getSupabase()!
        .from("saved_analyses")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId!);
      if (error) {
        console.error("[saved-analyses] PATCH failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  db.transaction(() => {
    const patch: Record<string, unknown> = {};
    if (name !== undefined) { db.prepare("UPDATE saved_analyses SET name = ? WHERE id = ?").run(name, id); patch.name = name; }
    if (notes !== undefined) { db.prepare("UPDATE saved_analyses SET notes = ? WHERE id = ?").run(notes, id); patch.notes = notes; }
    if (tags !== undefined) { db.prepare("UPDATE saved_analyses SET tags = ? WHERE id = ?").run(JSON.stringify(tags), id); patch.tags = tags; }
    if (Object.keys(patch).length) syncToSupabase({ table: "saved_analyses", action: "update", data: patch, match: { id, user_id: userId } });
  })();

  return NextResponse.json({ ok: true });
}
