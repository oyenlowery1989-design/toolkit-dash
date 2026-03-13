import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, folder_id, name, public_key, secret_key, position FROM wallets ORDER BY position ASC, name ASC"
  ).all() as {
    id: string; folder_id: string; name: string;
    public_key: string; secret_key: string; position: number;
  }[];
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      folderId: r.folder_id,
      name: r.name,
      publicKey: r.public_key,
      secretKey: r.secret_key, // intentional: local-only app, accepted risk
      position: r.position,
    }))
  );
}

export async function POST(req: NextRequest) {
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

  if (!id || typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!folderId || typeof folderId !== "string" || !folderId.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!publicKey || typeof publicKey !== "string" || !publicKey.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!secretKey || typeof secretKey !== "string" || !secretKey.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO wallets (id, folder_id, name, public_key, secret_key, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id.trim(), folderId.trim(), name.trim(), publicKey.trim(), secretKey.trim(), position);
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
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

  try {
    const db = getDb();
    db.prepare("UPDATE wallets SET name = ? WHERE id = ?").run(name.trim(), id.trim());
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = body as { id?: unknown };

  if (!id || typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const db = getDb();
    db.prepare("DELETE FROM wallets WHERE id = ?").run(id.trim());
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
