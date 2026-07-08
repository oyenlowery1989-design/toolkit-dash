import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

function mapRow(r: { id: string; name: string; position: number }) {
  return { id: r.id, name: r.name, position: r.position };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("wallet_folders")
      .select("id, name, position")
      .eq("user_id", userId!)
      .order("position", { ascending: true });
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, name, position FROM wallet_folders ORDER BY position ASC, name ASC"
  ).all() as { id: string; name: string; position: number }[];
  return NextResponse.json(rows.map(mapRow));
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

  const { id, name, position = 0 } = body as {
    id?: unknown; name?: unknown; position?: unknown;
  };

  if (!id || typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const trimmedId = (id as string).trim();
  const trimmedName = (name as string).trim();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("wallet_folders").upsert({
      id: trimmedId,
      user_id: userId,
      name: trimmedName,
      position: position as number,
    });
    if (error) {
      console.error("[wallet-folders] POST failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    getDb().prepare(
      "INSERT INTO wallet_folders (id, name, position) VALUES (?, ?, ?)"
    ).run(trimmedId, trimmedName, position);
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  syncToSupabase(() =>
    getSupabase()!.from("wallet_folders").upsert({
      id: trimmedId,
      user_id: userId,
      name: trimmedName,
      position: position as number,
    }),
  );

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, name } = body as { id?: unknown; name?: unknown };

  if (!id || typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const trimmedId = (id as string).trim();
  const trimmedName = (name as string).trim();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!
      .from("wallet_folders")
      .update({ name: trimmedName })
      .eq("id", trimmedId)
      .eq("user_id", userId!);
    if (error) {
      console.error("[wallet-folders] PATCH failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    getDb().prepare("UPDATE wallet_folders SET name = ? WHERE id = ?").run(trimmedName, trimmedId);
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  syncToSupabase(() =>
    getSupabase()!.from("wallet_folders").update({ name: trimmedName }).eq("id", trimmedId).eq("user_id", userId!),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key } = body as { key?: unknown };

  if (!key || typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const trimmedId = (key as string).trim();

  if (isSupabaseOnly()) {
    // On Supabase, wallets FK cascades on delete (defined in schema)
    const { error } = await getSupabase()!
      .from("wallet_folders")
      .delete()
      .eq("id", trimmedId)
      .eq("user_id", userId!);
    if (error) {
      console.error("[wallet-folders] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    getDb().transaction(() => {
      getDb().prepare("DELETE FROM wallets WHERE folder_id = ?").run(trimmedId);
      getDb().prepare("DELETE FROM wallet_folders WHERE id = ?").run(trimmedId);
    })();
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  syncToSupabase(() =>
    getSupabase()!.from("wallet_folders").delete().eq("id", trimmedId).eq("user_id", userId!),
  );

  return NextResponse.json({ ok: true });
}
