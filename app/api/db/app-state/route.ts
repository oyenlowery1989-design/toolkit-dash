import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM app_state").all() as {
    key: string; value: string;
  }[];
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
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
  // value may be empty string (means "clear this key")
  if (typeof value !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (key.length > 200) {
    return NextResponse.json({ error: "Key too long" }, { status: 400 });
  }

  try {
    const db = getDb();
    const trimmedValue = value.trim();
    if (trimmedValue === "") {
      // Clear the key
      db.prepare("DELETE FROM app_state WHERE key = ?").run(key.trim());
    } else {
      db.prepare(
        "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(key.trim(), trimmedValue);
    }
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
