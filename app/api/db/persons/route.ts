import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";
import type { Person, PersonAddress } from "@/lib/persons/types";

type PersonRow = Record<string, unknown>;
type AddressRow = Record<string, unknown>;

function rowToAddress(r: AddressRow): PersonAddress {
  return {
    id: r.id as string,
    personId: r.person_id as string,
    address: r.address as string,
    label: (r.label as string) ?? undefined,
    addedAt: r.added_at as number,
  };
}

function rowToPerson(r: PersonRow, addresses: PersonAddress[]): Person {
  return {
    id: r.id as string,
    name: r.name as string,
    role: (r.role as string) ?? undefined,
    notes: (r.notes as string) ?? undefined,
    telegramChannel: (r.telegram_channel as string) ?? undefined,
    telegramLink: (r.telegram_link as string) ?? undefined,
    addresses,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function buildPersonsFromRows(persons: PersonRow[], allAddresses: AddressRow[]): Person[] {
  const addressesByPerson = new Map<string, PersonAddress[]>();
  for (const a of allAddresses) {
    const pid = a.person_id as string;
    if (!addressesByPerson.has(pid)) addressesByPerson.set(pid, []);
    addressesByPerson.get(pid)!.push(rowToAddress(a));
  }
  return persons.map((p) => rowToPerson(p, addressesByPerson.get(p.id as string) ?? []));
}

/** GET /api/db/persons — all persons with their addresses */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: persons, error: personsError } = await sb
      .from("persons")
      .select("*")
      .eq("user_id", userId!)
      .order("updated_at", { ascending: false });
    if (personsError) {
      console.error("[persons] GET failed:", personsError);
      return NextResponse.json({ error: personsError.message }, { status: 500 });
    }
    const personIds = (persons ?? []).map((p) => p.id as string);
    const { data: allAddresses, error: addressesError } = personIds.length > 0
      ? await sb.from("person_addresses").select("*").in("person_id", personIds).order("added_at", { ascending: true })
      : { data: [], error: null };
    if (addressesError) {
      console.error("[persons] GET (addresses) failed:", addressesError);
      return NextResponse.json({ error: addressesError.message }, { status: 500 });
    }
    return NextResponse.json(buildPersonsFromRows(persons ?? [], allAddresses ?? []));
  }

  const db = getDb();
  const persons = db
    .prepare("SELECT * FROM persons ORDER BY updated_at DESC")
    .all() as PersonRow[];
  const allAddresses = db
    .prepare("SELECT * FROM person_addresses ORDER BY added_at ASC")
    .all() as AddressRow[];
  return NextResponse.json(buildPersonsFromRows(persons, allAddresses));
}

/** POST /api/db/persons — create person or add address */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = Date.now();

  if (body.type === "person") {
    const { id, name, role, notes, telegramChannel, telegramLink } = body;
    const nameTrimmed = (name ?? "").trim();

    if (isSupabaseOnly()) {
      const sb = getSupabase()!;
      // IDOR guard: a client-supplied id must not let the caller hijack another
      // user's existing row via upsert — only allow upsert onto a row that either
      // doesn't exist yet, or is already owned by this caller.
      const { data: existing } = await sb.from("persons").select("user_id").eq("id", id).maybeSingle();
      if (existing && existing.user_id !== userId) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      const { error } = await sb.from("persons").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        role: role ?? null,
        notes: notes ?? null,
        telegram_channel: telegramChannel ?? null,
        telegram_link: telegramLink ?? null,
        created_at: now,
        updated_at: now,
      });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    getDb()
      .prepare(
        `INSERT INTO persons (id, name, role, notes, telegram_channel, telegram_link, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name             = excluded.name,
           role             = excluded.role,
           notes            = excluded.notes,
           telegram_channel = excluded.telegram_channel,
           telegram_link    = excluded.telegram_link,
           updated_at       = excluded.updated_at`,
      )
      .run(id, nameTrimmed, role ?? null, notes ?? null, telegramChannel ?? null, telegramLink ?? null, now, now);

    syncToSupabase(async () => {
      await getSupabase()!.from("persons").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        role: role ?? null,
        notes: notes ?? null,
        telegram_channel: telegramChannel ?? null,
        telegram_link: telegramLink ?? null,
        created_at: now,
        updated_at: now,
      });
    });

    return NextResponse.json({ ok: true });
  }

  if (body.type === "address") {
    const { id, personId, address, label } = body;

    if (isSupabaseOnly()) {
      const sb = getSupabase()!;
      // IDOR guard: only let the caller add addresses to a person they own.
      const { data: ownerPerson } = await sb
        .from("persons")
        .select("id")
        .eq("id", personId)
        .eq("user_id", userId!)
        .single();
      if (!ownerPerson) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      const { error } = await sb.from("person_addresses").upsert(
        { id, person_id: personId, address, label: label ?? null, added_at: now },
        { onConflict: "person_id,address" },
      );
      if (error) {
        if (error.code === "23503") return NextResponse.json({ ok: false, error: "person_not_found" }, { status: 409 });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      await sb.from("persons").update({ updated_at: now }).eq("id", personId).eq("user_id", userId!);
      return NextResponse.json({ ok: true });
    }

    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO person_addresses (id, person_id, address, label, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(person_id, address) DO UPDATE SET
           label = excluded.label`,
      ).run(id, personId, address, label ?? null, now);
      db.prepare("UPDATE persons SET updated_at = ? WHERE id = ?").run(now, personId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("foreign key")) {
        return NextResponse.json({ ok: false, error: "person_not_found" }, { status: 409 });
      }
      throw error;
    }

    syncToSupabase(async () => {
      const sb = getSupabase()!;
      await sb.from("person_addresses").upsert(
        { id, person_id: personId, address, label: label ?? null, added_at: now },
        { onConflict: "person_id,address" },
      );
      await sb.from("persons").update({ updated_at: now }).eq("id", personId).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}

/** PATCH /api/db/persons — update person fields */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = Date.now();

  if (body.type !== "person") {
    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  }

  const { id, name, role, notes, telegramChannel, telegramLink } = body;

  if (isSupabaseOnly()) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (notes !== undefined) patch.notes = notes;
    if (telegramChannel !== undefined) patch.telegram_channel = telegramChannel;
    if (telegramLink !== undefined) patch.telegram_link = telegramLink;
    const { error } = await getSupabase()!.from("persons").update(patch).eq("id", id).eq("user_id", userId!);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `UPDATE persons SET
         name             = COALESCE(?, name),
         role             = COALESCE(?, role),
         notes            = COALESCE(?, notes),
         telegram_channel = COALESCE(?, telegram_channel),
         telegram_link    = COALESCE(?, telegram_link),
         updated_at       = ?
       WHERE id = ?`,
    )
    .run(name ?? null, role ?? null, notes ?? null, telegramChannel ?? null, telegramLink ?? null, now, id);

  syncToSupabase(async () => {
    const patch: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (notes !== undefined) patch.notes = notes;
    if (telegramChannel !== undefined) patch.telegram_channel = telegramChannel;
    if (telegramLink !== undefined) patch.telegram_link = telegramLink;
    await getSupabase()!.from("persons").update(patch).eq("id", id).eq("user_id", userId!);
  });

  return NextResponse.json({ ok: true });
}

/** DELETE /api/db/persons — delete person or address */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let key: string, type: string;
  try { ({ key, type } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    if (type === "person") {
      const { error } = await sb.from("persons").delete().eq("id", key).eq("user_id", userId!);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    } else {
      // person_addresses has no user_id — scope via parent person ownership
      const { data: addr } = await sb.from("person_addresses").select("person_id").eq("id", key).single();
      if (addr) {
        const { data: parentPerson } = await sb.from("persons").select("id").eq("id", addr.person_id).eq("user_id", userId!).single();
        if (parentPerson) {
          const { error } = await sb.from("person_addresses").delete().eq("id", key);
          if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  if (type === "person") {
    db.prepare("DELETE FROM persons WHERE id = ?").run(key);
  } else if (type === "address") {
    db.prepare("DELETE FROM person_addresses WHERE id = ?").run(key);
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    if (type === "person") {
      return sb.from("persons").delete().eq("id", key).eq("user_id", userId!);
    } else {
      const { data: addr } = await sb.from("person_addresses").select("person_id").eq("id", key).single();
      if (!addr) return;
      const { data: parentPerson } = await sb.from("persons").select("id").eq("id", addr.person_id).eq("user_id", userId!).single();
      if (!parentPerson) return;
      return sb.from("person_addresses").delete().eq("id", key);
    }
  });

  return NextResponse.json({ ok: true });
}
