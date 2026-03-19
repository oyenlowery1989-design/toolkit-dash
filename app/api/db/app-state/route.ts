import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("app_state")
      .select("key, value")
      .eq("user_id", userId!);
    const result: Record<string, string> = {};
    for (const r of data ?? []) result[r.key] = r.value;
    return NextResponse.json(result);
  }
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM app_state").all() as {
    key: string; value: string;
  }[];
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, value } = body as { key?: unknown; value?: unknown };

  if (!key || typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (typeof value !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (key.length > 200) {
    return NextResponse.json({ error: "Key too long" }, { status: 400 });
  }

  const trimmedKey = key.trim();
  const trimmedValue = value.trim();

  if (!isSupabaseOnly()) {
    try {
      const db = getDb();
      if (trimmedValue === "") {
        db.prepare("DELETE FROM app_state WHERE key = ?").run(trimmedKey);
      } else {
        db.prepare(
          "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(trimmedKey, trimmedValue);
      }
    } catch {
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
  }

  syncToSupabase(() => {
    const sb = getSupabase()!;
    if (trimmedValue === "") {
      return sb.from("app_state").delete().eq("user_id", userId!).eq("key", trimmedKey);
    }
    return sb.from("app_state").upsert(
      { user_id: userId, key: trimmedKey, value: trimmedValue },
      { onConflict: "user_id,key" },
    );
  });

  return NextResponse.json({ ok: true });
}
