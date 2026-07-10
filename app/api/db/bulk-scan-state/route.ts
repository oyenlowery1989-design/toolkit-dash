import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

function localId(scanKey: string): string {
  return `local:${scanKey}`;
}

function getScanKey(req: NextRequest): string {
  return req.nextUrl.searchParams.get("scanKey") || "default";
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;
  const scanKey = getScanKey(req);

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("bulk_scan_state")
      .select("rows_json, interrupted, updated_at")
      .eq("user_id", userId!)
      .eq("scan_key", scanKey)
      .maybeSingle();
    if (!data) return NextResponse.json(null);
    return NextResponse.json({
      rowsJson: data.rows_json,
      interrupted: !!data.interrupted,
      updatedAt: data.updated_at,
    });
  }

  const row = getDb()
    .prepare("SELECT rows_json, interrupted, updated_at FROM bulk_scan_state WHERE id = ?")
    .get(localId(scanKey)) as { rows_json: string; interrupted: number; updated_at: number } | undefined;
  if (!row) return NextResponse.json(null);
  return NextResponse.json({
    rowsJson: row.rows_json,
    interrupted: !!row.interrupted,
    updatedAt: row.updated_at,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;
  const scanKey = getScanKey(req);

  let body: { rowsJson?: unknown; interrupted?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.rowsJson !== "string") {
    return NextResponse.json({ error: "rowsJson (string) required" }, { status: 400 });
  }
  const rowsJson = body.rowsJson;
  const interrupted = !!body.interrupted;
  const now = Date.now();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("bulk_scan_state").upsert(
      { user_id: userId, scan_key: scanKey, rows_json: rowsJson, interrupted, updated_at: now },
      { onConflict: "user_id,scan_key" },
    );
    if (error) {
      console.error("[bulk-scan-state] POST failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `INSERT INTO bulk_scan_state (id, scan_key, rows_json, interrupted, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scan_key = excluded.scan_key,
         rows_json = excluded.rows_json,
         interrupted = excluded.interrupted,
         updated_at = excluded.updated_at`,
    )
    .run(localId(scanKey), scanKey, rowsJson, interrupted ? 1 : 0, now);

  syncToSupabase(() =>
    getSupabase()!.from("bulk_scan_state").upsert(
      { user_id: userId, scan_key: scanKey, rows_json: rowsJson, interrupted, updated_at: now },
      { onConflict: "user_id,scan_key" },
    ),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;
  const scanKey = getScanKey(req);

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!
      .from("bulk_scan_state")
      .delete()
      .eq("user_id", userId!)
      .eq("scan_key", scanKey);
    if (error) {
      console.error("[bulk-scan-state] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb().prepare("DELETE FROM bulk_scan_state WHERE id = ?").run(localId(scanKey));

  syncToSupabase(() =>
    getSupabase()!.from("bulk_scan_state").delete().eq("user_id", userId!).eq("scan_key", scanKey),
  );

  return NextResponse.json({ ok: true });
}
