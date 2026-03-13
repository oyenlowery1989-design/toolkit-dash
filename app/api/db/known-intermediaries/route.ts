import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const PRESEEDED = [
  {
    address: "GDBIXGZ3EKI3M4DBM65ADLHVNYIOG7JXGOHW5DHUZQAXPORY3QNO2PNY",
    name: "ChangeNow",
    notes: "Non-custodial crypto exchange service. Commonly used to anonymize the origin of Stellar account creation.",
    added_at: 0,
  },
];

export async function GET() {
  const db = getDb();
  let rows = db
    .prepare("SELECT * FROM known_intermediaries ORDER BY added_at DESC")
    .all() as Record<string, unknown>[];

  // Seed defaults on first use
  if (rows.length === 0) {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO known_intermediaries (address, name, notes, added_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const s of PRESEEDED) insert.run(s.address, s.name, s.notes, s.added_at);
    rows = db
      .prepare("SELECT * FROM known_intermediaries ORDER BY added_at DESC")
      .all() as Record<string, unknown>[];
  }

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
      `INSERT INTO known_intermediaries (address, name, notes, added_at)
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
  getDb().prepare("DELETE FROM known_intermediaries WHERE address = ?").run(key);
  return NextResponse.json({ ok: true });
}
