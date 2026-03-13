import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM address_book ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      publicKey: r.public_key,
      label: r.label,
      notes: r.notes ?? undefined,
      color: r.color ?? undefined,
      timestamp: r.created_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  getDb()
    .prepare(
      `INSERT INTO address_book (public_key, label, notes, color, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(public_key) DO UPDATE SET
         label = excluded.label,
         notes = excluded.notes,
         color = excluded.color`,
    )
    .run(b.publicKey, b.label, b.notes ?? null, b.color ?? null, b.timestamp ?? Date.now());
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  getDb().prepare("DELETE FROM address_book WHERE public_key = ?").run(key);
  return NextResponse.json({ ok: true });
}
