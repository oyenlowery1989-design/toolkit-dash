import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

type WalletRow = {
  id: string; folder_id: string; name: string;
  public_key: string; secret_key: string; position: number;
};

function mapRow(r: WalletRow) {
  return {
    id: r.id,
    folderId: r.folder_id,
    name: r.name,
    publicKey: r.public_key,
    secretKey: r.secret_key, // intentional: personal app, accepted risk
    position: r.position,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("wallets")
      .select("id, folder_id, name, public_key, secret_key, position")
      .eq("user_id", userId!)
      .order("position", { ascending: true });
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, folder_id, name, public_key, secret_key, position FROM wallets ORDER BY position ASC, name ASC"
  ).all() as WalletRow[];
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

  const { id, folderId, name, publicKey, secretKey, position = 0 } = body as {
    id?: unknown; folderId?: unknown; name?: unknown;
    publicKey?: unknown; secretKey?: unknown; position?: unknown;
  };

  if (!id || typeof id !== "string" || !id.trim()) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (!folderId || typeof folderId !== "string" || !folderId.trim()) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (!name || typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (!publicKey || typeof publicKey !== "string" || !publicKey.trim()) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (secretKey === undefined || secretKey === null || typeof secretKey !== "string") return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  const trimId = (id as string).trim();
  const trimFolderId = (folderId as string).trim();
  const trimName = (name as string).trim();
  const trimPublicKey = (publicKey as string).trim();
  const trimSecretKey = (secretKey as string).trim(); // empty string = watch-only, intentional

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: dup } = await sb
      .from("wallets")
      .select("id, name")
      .eq("user_id", userId!)
      .eq("public_key", trimPublicKey)
      .limit(1)
      .single();
    if (dup) return NextResponse.json({ error: `Already saved as "${dup.name}".` }, { status: 409 });

    const { error } = await sb.from("wallets").upsert({
      id: trimId,
      user_id: userId,
      folder_id: trimFolderId,
      name: trimName,
      public_key: trimPublicKey,
      secret_key: trimSecretKey,
      position: position as number,
    });
    if (error) {
      console.error("[wallets-v2] POST failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    const dup = getDb().prepare("SELECT id, name FROM wallets WHERE public_key = ?").get(trimPublicKey) as { id: string; name: string } | undefined;
    if (dup) return NextResponse.json({ error: `Already saved as "${dup.name}".` }, { status: 409 });
    getDb().prepare(
      "INSERT INTO wallets (id, folder_id, name, public_key, secret_key, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(trimId, trimFolderId, trimName, trimPublicKey, trimSecretKey, position);
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  syncToSupabase(() =>
    getSupabase()!.from("wallets").upsert({
      id: trimId,
      user_id: userId,
      folder_id: trimFolderId,
      name: trimName,
      public_key: trimPublicKey,
      secret_key: trimSecretKey,
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

  const { id, name, folderId } = body as { id?: unknown; name?: unknown; folderId?: unknown };

  if (!id || typeof id !== "string" || !id.trim()) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  const trimId = (id as string).trim();

  if (folderId !== undefined) {
    if (!folderId || typeof folderId !== "string" || !folderId.trim()) return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
    const trimFolderId = (folderId as string).trim();

    if (isSupabaseOnly()) {
      const { error } = await getSupabase()!.from("wallets").update({ folder_id: trimFolderId }).eq("id", trimId).eq("user_id", userId!);
      if (error) {
        console.error("[wallets-v2] PATCH folderId failed:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    try {
      getDb().prepare("UPDATE wallets SET folder_id = ? WHERE id = ?").run(trimFolderId, trimId);
    } catch {
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    syncToSupabase(() =>
      getSupabase()!.from("wallets").update({ folder_id: trimFolderId }).eq("id", trimId).eq("user_id", userId!),
    );
    return NextResponse.json({ ok: true });
  }

  if (!name || typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  const trimName = (name as string).trim();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("wallets").update({ name: trimName }).eq("id", trimId).eq("user_id", userId!);
    if (error) {
      console.error("[wallets-v2] PATCH name failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    getDb().prepare("UPDATE wallets SET name = ? WHERE id = ?").run(trimName, trimId);
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  syncToSupabase(() =>
    getSupabase()!.from("wallets").update({ name: trimName }).eq("id", trimId).eq("user_id", userId!),
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

  const trimId = (key as string).trim();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("wallets").delete().eq("id", trimId).eq("user_id", userId!);
    if (error) {
      console.error("[wallets-v2] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    getDb().prepare("DELETE FROM wallets WHERE id = ?").run(trimId);
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  syncToSupabase(() =>
    getSupabase()!.from("wallets").delete().eq("id", trimId).eq("user_id", userId!),
  );

  return NextResponse.json({ ok: true });
}
