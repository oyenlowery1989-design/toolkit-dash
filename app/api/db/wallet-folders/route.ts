import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, name, position FROM wallet_folders ORDER BY position ASC, name ASC"
  ).all() as { id: string; name: string; position: number }[];
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
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

  const trimmedName = name.trim();

  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO wallet_folders (id, name, position) VALUES (?, ?, ?)"
    ).run(id.trim(), trimmedName, position);
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
    db.prepare("UPDATE wallet_folders SET name = ? WHERE id = ?").run(name.trim(), id.trim());
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
    // Manually cascade since FK constraint can't be added via ALTER TABLE on existing DBs
    db.transaction(() => {
      db.prepare("DELETE FROM wallets WHERE folder_id = ?").run(id.trim());
      db.prepare("DELETE FROM wallet_folders WHERE id = ?").run(id.trim());
    })();
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
