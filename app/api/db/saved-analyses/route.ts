import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const MAX = 50;

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM saved_analyses ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      assetCode: r.asset_code,
      issuer: r.issuer,
      distribAddresses: JSON.parse(r.distrib_addresses as string),
      network: r.network,
      result: JSON.parse(r.result_json as string),
      notes: r.notes ?? undefined,
      tags: r.tags ? JSON.parse(r.tags as string) : undefined,
      timestamp: r.created_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  db.prepare(
    `INSERT INTO saved_analyses
       (id, name, asset_code, issuer, distrib_addresses, network, result_json, notes, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       notes = excluded.notes,
       tags  = excluded.tags`,
  ).run(
    b.id,
    b.name,
    b.assetCode,
    b.issuer,
    JSON.stringify(b.distribAddresses ?? []),
    b.network,
    JSON.stringify(b.result),
    b.notes ?? null,
    b.tags ? JSON.stringify(b.tags) : null,
    b.timestamp ?? Date.now(),
  );
  // Trim to MAX
  db.prepare(
    `DELETE FROM saved_analyses WHERE id NOT IN
     (SELECT id FROM saved_analyses ORDER BY created_at DESC LIMIT ?)`,
  ).run(MAX);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  getDb().prepare("DELETE FROM saved_analyses WHERE id = ?").run(key);
  return NextResponse.json({ ok: true });
}

// PATCH used for name/notes/tags-only updates
export async function PATCH(req: NextRequest) {
  const { id, name, notes, tags } = await req.json();
  const db = getDb();
  if (name !== undefined) db.prepare("UPDATE saved_analyses SET name = ? WHERE id = ?").run(name, id);
  if (notes !== undefined) db.prepare("UPDATE saved_analyses SET notes = ? WHERE id = ?").run(notes, id);
  if (tags !== undefined) db.prepare("UPDATE saved_analyses SET tags = ? WHERE id = ?").run(JSON.stringify(tags), id);
  return NextResponse.json({ ok: true });
}
