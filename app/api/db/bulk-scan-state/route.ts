import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

const LOCAL_ID = "local";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("bulk_scan_state")
      .select("rows_json, interrupted, updated_at")
      .eq("user_id", userId!)
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
    .get(LOCAL_ID) as { rows_json: string; interrupted: number; updated_at: number } | undefined;
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

  if (!isSupabaseOnly()) {
    getDb()
      .prepare(
        `INSERT INTO bulk_scan_state (id, rows_json, interrupted, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           rows_json = excluded.rows_json,
           interrupted = excluded.interrupted,
           updated_at = excluded.updated_at`,
      )
      .run(LOCAL_ID, rowsJson, interrupted ? 1 : 0, now);
  }

  syncToSupabase(() =>
    getSupabase()!.from("bulk_scan_state").upsert({
      user_id: userId,
      rows_json: rowsJson,
      interrupted,
      updated_at: now,
    }),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (!isSupabaseOnly()) {
    getDb().prepare("DELETE FROM bulk_scan_state WHERE id = ?").run(LOCAL_ID);
  }

  syncToSupabase(() =>
    getSupabase()!.from("bulk_scan_state").delete().eq("user_id", userId!),
  );

  return NextResponse.json({ ok: true });
}
