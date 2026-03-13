import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM bulk_recipients ORDER BY saved_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      network: r.network,
      addresses: JSON.parse(r.addresses as string),
      assetsText: r.assets_text ?? undefined,
      savedAt: r.saved_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  getDb()
    .prepare(
      `INSERT INTO bulk_recipients (id, name, network, addresses, assets_text, saved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         addresses = excluded.addresses,
         assets_text = excluded.assets_text,
         saved_at = excluded.saved_at`,
    )
    .run(b.id, b.name, b.network, JSON.stringify(b.addresses), b.assetsText ?? null, b.savedAt ?? Date.now());
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  getDb().prepare("DELETE FROM bulk_recipients WHERE id = ?").run(key);
  return NextResponse.json({ ok: true });
}
