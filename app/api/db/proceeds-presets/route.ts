import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const MAX = 30;

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM proceeds_presets ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      assetCode: r.asset_code,
      issuer: r.issuer,
      distributionAddress: r.distribution_address,
      network: r.network,
      accountsText: r.accounts_text,
      createdAt: r.created_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  db.prepare(
    `INSERT INTO proceeds_presets (id, asset_code, issuer, distribution_address, network, accounts_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       accounts_text = excluded.accounts_text,
       created_at = excluded.created_at`,
  ).run(b.id, b.assetCode, b.issuer, b.distributionAddress, b.network, b.accountsText, b.createdAt ?? Date.now());
  db.prepare(
    `DELETE FROM proceeds_presets WHERE id NOT IN
     (SELECT id FROM proceeds_presets ORDER BY created_at DESC LIMIT ?)`,
  ).run(MAX);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  getDb().prepare("DELETE FROM proceeds_presets WHERE id = ?").run(key);
  return NextResponse.json({ ok: true });
}
