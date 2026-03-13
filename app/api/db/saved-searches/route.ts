import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const MAX = 30;

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM saved_searches ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      type: r.type,
      value: r.value,
      label: r.label ?? undefined,
      network: r.network ?? undefined,
      distribAddress: r.distrib_address ?? undefined,
      totalXlmProceeds: r.total_xlm_proceeds ?? undefined,
      totalAssetSold: r.total_asset_sold ?? undefined,
      intermediaryName: r.intermediary_name ?? undefined,
      accountsFound: r.accounts_found ?? undefined,
      timestamp: r.created_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  // ON CONFLICT updates the row, effectively moving it to "newest"
  db.prepare(
    `INSERT INTO saved_searches
       (type, value, label, network, distrib_address, total_xlm_proceeds,
        total_asset_sold, intermediary_name, accounts_found, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(type, value) DO UPDATE SET
       label              = excluded.label,
       network            = excluded.network,
       distrib_address    = excluded.distrib_address,
       total_xlm_proceeds = excluded.total_xlm_proceeds,
       total_asset_sold   = excluded.total_asset_sold,
       intermediary_name  = excluded.intermediary_name,
       accounts_found     = excluded.accounts_found,
       created_at         = excluded.created_at`,
  ).run(
    b.type, b.value, b.label ?? null, b.network ?? null,
    b.distribAddress ?? null, b.totalXlmProceeds ?? null,
    b.totalAssetSold ?? null, b.intermediaryName ?? null,
    b.accountsFound ?? null, b.timestamp ?? Date.now(),
  );
  db.prepare(
    `DELETE FROM saved_searches WHERE id NOT IN
     (SELECT id FROM saved_searches ORDER BY created_at DESC LIMIT ?)`,
  ).run(MAX);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();  // key = timestamp number
  getDb().prepare("DELETE FROM saved_searches WHERE created_at = ?").run(key);
  return NextResponse.json({ ok: true });
}
