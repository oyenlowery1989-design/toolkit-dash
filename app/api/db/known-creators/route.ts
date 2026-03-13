import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM known_creators ORDER BY added_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      address: r.address,
      name: r.name,
      notes: r.notes ?? undefined,
      addedAt: r.added_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  getDb()
    .prepare(
      `INSERT INTO known_creators (address, name, notes, added_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name,
         notes = excluded.notes`,
    )
    .run(b.address, b.name, b.notes ?? null, b.addedAt ?? Date.now());
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  getDb().prepare("DELETE FROM known_creators WHERE address = ?").run(key);
  return NextResponse.json({ ok: true });
}
