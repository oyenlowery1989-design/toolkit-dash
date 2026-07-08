import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

const PRESEEDED = [
  {
    address: "GDBIXGZ3EKI3M4DBM65ADLHVNYIOG7JXGOHW5DHUZQAXPORY3QNO2PNY",
    name: "ChangeNow",
    notes: "Non-custodial crypto exchange service. Commonly used to anonymize the origin of Stellar account creation.",
    added_at: 0,
  },
];

function mapRow(r: Record<string, unknown>) {
  return {
    address: r.address,
    name: r.name,
    notes: r.notes ?? undefined,
    addedAt: r.added_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    let { data } = await sb
      .from("known_intermediaries")
      .select("*")
      .eq("user_id", userId!)
      .order("added_at", { ascending: false });
    // Seed defaults on first use (per user)
    if (!data || data.length === 0) {
      await sb.from("known_intermediaries").upsert(
        PRESEEDED.map((s) => ({ ...s, user_id: userId })),
        { onConflict: "user_id,address" },
      );
      ({ data } = await sb
        .from("known_intermediaries")
        .select("*")
        .eq("user_id", userId!)
        .order("added_at", { ascending: false }));
    }
    return NextResponse.json((data ?? []).map(mapRow));
  }

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

  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.address || !StrKey.isValidEd25519PublicKey(b.address)) {
    return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
  }
  const now = b.addedAt ?? Date.now();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("known_intermediaries").upsert(
      {
        user_id: userId,
        address: b.address,
        name: b.name,
        notes: b.notes ?? null,
        added_at: now,
      },
      { onConflict: "user_id,address" },
    );
    if (error) {
      console.error("[known-intermediaries] POST failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `INSERT INTO known_intermediaries (address, name, notes, added_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name,
         notes = excluded.notes`,
    )
    .run(b.address, b.name, b.notes ?? null, now);

  syncToSupabase(() =>
    getSupabase()!.from("known_intermediaries").upsert(
      {
        user_id: userId,
        address: b.address,
        name: b.name,
        notes: b.notes ?? null,
        added_at: now,
      },
      { onConflict: "user_id,address" },
    ),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let key: string;
  try { ({ key } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!
      .from("known_intermediaries")
      .delete()
      .eq("user_id", userId!)
      .eq("address", key);
    if (error) {
      console.error("[known-intermediaries] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb().prepare("DELETE FROM known_intermediaries WHERE address = ?").run(key);

  syncToSupabase(() =>
    getSupabase()!.from("known_intermediaries").delete().eq("user_id", userId!).eq("address", key),
  );

  return NextResponse.json({ ok: true });
}
