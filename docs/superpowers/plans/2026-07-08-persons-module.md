# Persons Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone Persons registry (name/role/notes + linked addresses), attributable to Asset Groups via a single `person_id` FK — replacing the `personName`/`personRole` free-text fields added earlier this session.

**Architecture:** New `persons` + `person_addresses` tables and a dual-mode API route/hook pair, built by copying the shape of `asset_groups`/`asset_group_members` (entity + nested children) exactly — same `createDbCache` hook pattern, same SQLite/Supabase branching. `asset_groups.person_id` replaces `person_name`/`person_role`. One implementation simplification vs. the spec: instead of a single CASE-based SQL expression to distinguish "clear to NULL" from "leave untouched," this plan uses a dedicated `clearPersonId` flag handled as a second, separate SQL statement — same external behavior (unlink actually sets NULL, linking/no-op work as before), simpler to read.

**Tech Stack:** Same as prior asset-groups work — Next.js API routes, better-sqlite3, Supabase, React. No new pure-logic module (CRUD only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-08-persons-module-design.md`
- One attributed person per asset group (not multiple). Role lives on the person record, not per-group.
- Persons can link directly to addresses (`person_addresses`), independent of asset group membership.
- No clustering/grouping-by-person view. No Person integration into `lib/address-resolver.ts`'s `ShortAddress` badge chain.
- Schema changes touch both `lib/db.ts` and `supabase-schema.sql` in the same task.

---

### Task 1: Schema — `persons`, `person_addresses`, `asset_groups.person_id`

**Files:**
- Modify: `lib/db.ts`
- Modify: `supabase-schema.sql`

**Interfaces:**
- Produces: `persons` table, `person_addresses` table, `asset_groups.person_id` column (nullable FK) — consumed by Task 2 (types), Task 3 (persons API), Task 4 (groups API).

- [ ] **Step 1: Add the new tables to `lib/db.ts`**

Add this block right after the closing of the Asset Groups section (after the `asset_group_members` indexes, before `-- ── Wallet Manager ──`):

```typescript
    -- ── Persons (important-person registry — CEO, founder, etc) ────────────────

    CREATE TABLE IF NOT EXISTS persons (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      role        TEXT,
      notes       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_addresses (
      id         TEXT    PRIMARY KEY,
      person_id  TEXT    NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      address    TEXT    NOT NULL,
      label      TEXT,
      added_at   INTEGER NOT NULL,
      UNIQUE(person_id, address)
    );

    CREATE INDEX IF NOT EXISTS idx_person_addresses_person ON person_addresses(person_id);
    CREATE INDEX IF NOT EXISTS idx_person_addresses_address ON person_addresses(address);

```

- [ ] **Step 2: Update the `asset_groups` CREATE TABLE (fresh installs) and add a migration for existing DBs**

Replace:

```typescript
    CREATE TABLE IF NOT EXISTS asset_groups (
      id               TEXT    PRIMARY KEY,
      name             TEXT    NOT NULL,
      asset_code       TEXT,
      issuer           TEXT,
      network          TEXT    NOT NULL DEFAULT 'public',
      notes            TEXT,
      domain           TEXT,
      telegram_channel TEXT,
      telegram_link    TEXT,
      person_name      TEXT,
      person_role      TEXT,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
```

with:

```typescript
    CREATE TABLE IF NOT EXISTS asset_groups (
      id               TEXT    PRIMARY KEY,
      name             TEXT    NOT NULL,
      asset_code       TEXT,
      issuer           TEXT,
      network          TEXT    NOT NULL DEFAULT 'public',
      notes            TEXT,
      domain           TEXT,
      telegram_channel TEXT,
      telegram_link    TEXT,
      person_id        TEXT    REFERENCES persons(id) ON DELETE SET NULL,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
```

Then, in the migration section, replace:

```typescript
  if (!assetGroupCols.includes("telegram_link")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN telegram_link TEXT`);
  }
  if (!assetGroupCols.includes("person_name")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN person_name TEXT`);
  }
  if (!assetGroupCols.includes("person_role")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN person_role TEXT`);
  }
```

with:

```typescript
  if (!assetGroupCols.includes("telegram_link")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN telegram_link TEXT`);
  }
  if (assetGroupCols.includes("person_name")) {
    db.exec(`ALTER TABLE asset_groups DROP COLUMN person_name`);
  }
  if (assetGroupCols.includes("person_role")) {
    db.exec(`ALTER TABLE asset_groups DROP COLUMN person_role`);
  }
  if (!assetGroupCols.includes("person_id")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN person_id TEXT REFERENCES persons(id) ON DELETE SET NULL`);
  }
```

(The `persons` table from Step 1 must exist before this migration block runs — it does, since Step 1's `CREATE TABLE IF NOT EXISTS persons` is part of the same `db.exec` multi-statement string that runs before the per-column migration section further down the file.)

- [ ] **Step 3: Update `supabase-schema.sql`**

Add new tables (with `user_id`, following this file's multi-user convention) right after the `asset_group_members` block:

```sql
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id);
CREATE TABLE IF NOT EXISTS person_addresses (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, address TEXT NOT NULL, label TEXT, added_at BIGINT NOT NULL, UNIQUE(person_id, address));
CREATE INDEX IF NOT EXISTS idx_person_addresses_person ON person_addresses(person_id);
CREATE INDEX IF NOT EXISTS idx_person_addresses_address ON person_addresses(address);
```

Update the `asset_groups` CREATE TABLE line — replace `person_name TEXT, person_role TEXT,` with `person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,`.

Then append this migration block at the end of the file (mirrors the existing `auto_send_groups` migration-note block already in this file):

```sql

-- Persons module migration (for databases provisioned before this module existed)
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_name;
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_role;
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES persons(id) ON DELETE SET NULL;
```

- [ ] **Step 4: Verify the migration runs cleanly**

Run: `npx tsx -e "import { getDb } from './lib/db'; const db = getDb(); console.log('persons:', db.pragma('table_info(persons)').map(c=>c.name)); console.log('person_addresses:', db.pragma('table_info(person_addresses)').map(c=>c.name)); console.log('asset_groups:', db.pragma('table_info(asset_groups)').map(c=>c.name));"`

Expected: `persons` includes `id,name,role,notes,created_at,updated_at`; `person_addresses` includes `id,person_id,address,label,added_at`; `asset_groups` no longer includes `person_name`/`person_role`, includes `person_id`.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts supabase-schema.sql
git commit -m "feat(persons): add persons/person_addresses tables, replace asset_groups person_name/person_role with person_id"
```

---

### Task 2: Types

**Files:**
- Create: `lib/persons/types.ts`
- Modify: `lib/asset-groups/types.ts`

**Interfaces:**
- Produces: `Person`, `PersonAddress` types — consumed by Task 3 (API), Task 5 (hook), Task 7 (UI). `AssetGroup.personId?: string` — consumed by Task 4, Task 6, Task 8.

- [ ] **Step 1: Create `lib/persons/types.ts`**

```typescript
export interface PersonAddress {
  id: string;
  personId: string;
  address: string;
  label?: string;
  addedAt: number;
}

export interface Person {
  id: string;
  name: string;
  role?: string;
  notes?: string;
  addresses: PersonAddress[];
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Update `lib/asset-groups/types.ts`**

Replace:

```typescript
  domain?: string;
  telegramChannel?: string;
  telegramLink?: string;
  personName?: string;
  personRole?: string;
  createdAt: number;
```

with:

```typescript
  domain?: string;
  telegramChannel?: string;
  telegramLink?: string;
  personId?: string;
  createdAt: number;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `app/api/db/groups/route.ts`, `hooks/use-asset-groups.ts`, and `components/groups/GroupsPanel.tsx` referencing the now-removed `personName`/`personRole` — expected at this point, fixed in Tasks 4, 6, 8.

- [ ] **Step 4: Commit**

```bash
git add lib/persons/types.ts lib/asset-groups/types.ts
git commit -m "feat(persons): add Person/PersonAddress types, replace AssetGroup personName/personRole with personId"
```

---

### Task 3: Persons API route

**Files:**
- Create: `app/api/db/persons/route.ts`

**Interfaces:**
- Consumes: `Person`, `PersonAddress` (Task 2), `getDb`/`isSupabaseOnly`/`getSupabase`/`syncToSupabase`/`requireAuth` (existing `lib/db.ts`/`lib/supabase-server.ts`).
- Produces: `GET/POST/PATCH/DELETE /api/db/persons` — consumed by Task 5 (hook).

- [ ] **Step 1: Write the route, mirroring `app/api/db/groups/route.ts`'s entity+children shape**

```typescript
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
    const { data: persons } = await sb
      .from("persons")
      .select("*")
      .eq("user_id", userId!)
      .order("updated_at", { ascending: false });
    const personIds = (persons ?? []).map((p) => p.id as string);
    const { data: allAddresses } = personIds.length > 0
      ? await sb.from("person_addresses").select("*").in("person_id", personIds).order("added_at", { ascending: true })
      : { data: [] };
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
    const { id, name, role, notes } = body;
    const nameTrimmed = (name ?? "").trim();

    if (isSupabaseOnly()) {
      const { error } = await getSupabase()!.from("persons").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        role: role ?? null,
        notes: notes ?? null,
        created_at: now,
        updated_at: now,
      });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    getDb()
      .prepare(
        `INSERT INTO persons (id, name, role, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name       = excluded.name,
           role       = excluded.role,
           notes      = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .run(id, nameTrimmed, role ?? null, notes ?? null, now, now);

    syncToSupabase(async () => {
      await getSupabase()!.from("persons").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        role: role ?? null,
        notes: notes ?? null,
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

  const { id, name, role, notes } = body;

  if (isSupabaseOnly()) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (notes !== undefined) patch.notes = notes;
    const { error } = await getSupabase()!.from("persons").update(patch).eq("id", id).eq("user_id", userId!);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `UPDATE persons SET
         name       = COALESCE(?, name),
         role       = COALESCE(?, role),
         notes      = COALESCE(?, notes),
         updated_at = ?
       WHERE id = ?`,
    )
    .run(name ?? null, role ?? null, notes ?? null, now, id);

  syncToSupabase(async () => {
    const patch: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (notes !== undefined) patch.notes = notes;
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in this new file (remaining errors, if any, are the pre-existing ones from Task 2 Step 3, fixed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add app/api/db/persons/route.ts
git commit -m "feat(persons): add dual-mode API route for persons + person_addresses"
```

---

### Task 4: Groups API route — replace personName/personRole with person_id

**Files:**
- Modify: `app/api/db/groups/route.ts`

**Interfaces:**
- Consumes: `AssetGroup.personId` (Task 2).
- Produces: GET/POST/PATCH handle `person_id` (set via normal COALESCE path, clear via a dedicated `clearPersonId` flag) — consumed by Task 6 (hook).

- [ ] **Step 1: Update `rowToGroup`**

Replace:

```typescript
    domain: (r.domain as string) ?? undefined,
    telegramChannel: (r.telegram_channel as string) ?? undefined,
    telegramLink: (r.telegram_link as string) ?? undefined,
    personName: (r.person_name as string) ?? undefined,
    personRole: (r.person_role as string) ?? undefined,
    createdAt: r.created_at as number,
```

with:

```typescript
    domain: (r.domain as string) ?? undefined,
    telegramChannel: (r.telegram_channel as string) ?? undefined,
    telegramLink: (r.telegram_link as string) ?? undefined,
    personId: (r.person_id as string) ?? undefined,
    createdAt: r.created_at as number,
```

- [ ] **Step 2: Update the SQLite POST insert**

Replace:

```typescript
        db.prepare(
          `INSERT INTO asset_groups (id, name, asset_code, issuer, network, notes, domain, telegram_channel, telegram_link, person_name, person_role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name       = excluded.name,
             asset_code = excluded.asset_code,
             issuer     = excluded.issuer,
             network    = excluded.network,
             notes      = excluded.notes,
             updated_at = excluded.updated_at`,
        ).run(id, nameTrimmed, assetCodeNorm, issuerNorm, networkNorm, notes ?? null, null, null, null, null, null, now, now);
```

with:

```typescript
        db.prepare(
          `INSERT INTO asset_groups (id, name, asset_code, issuer, network, notes, domain, telegram_channel, telegram_link, person_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name       = excluded.name,
             asset_code = excluded.asset_code,
             issuer     = excluded.issuer,
             network    = excluded.network,
             notes      = excluded.notes,
             updated_at = excluded.updated_at`,
        ).run(id, nameTrimmed, assetCodeNorm, issuerNorm, networkNorm, notes ?? null, null, null, null, null, now, now);
```

- [ ] **Step 3: Update PATCH — set path via COALESCE, clear path via dedicated flag**

Replace:

```typescript
    const { id, name, notes, assetCode, issuer, network, domain, telegramChannel, telegramLink, personName, personRole } = body;

    if (isSupabaseOnly()) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
      if (domain !== undefined) patch.domain = domain;
      if (telegramChannel !== undefined) patch.telegram_channel = telegramChannel;
      if (telegramLink !== undefined) patch.telegram_link = telegramLink;
      if (personName !== undefined) patch.person_name = personName;
      if (personRole !== undefined) patch.person_role = personRole;
      const { error } = await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
      if (error) {
        if (error.code === "23503") return NextResponse.json({ ok: false, error: "group_not_found" }, { status: 409 });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    getDb()
      .prepare(
        `UPDATE asset_groups SET
           name             = COALESCE(?, name),
           notes            = COALESCE(?, notes),
           asset_code       = COALESCE(?, asset_code),
           issuer           = COALESCE(?, issuer),
           network          = COALESCE(?, network),
           domain           = COALESCE(?, domain),
           telegram_channel = COALESCE(?, telegram_channel),
           telegram_link    = COALESCE(?, telegram_link),
           person_name      = COALESCE(?, person_name),
           person_role      = COALESCE(?, person_role),
           updated_at       = ?
         WHERE id = ?`,
      )
      .run(
        name ?? null,
        notes ?? null,
        assetCode ?? null,
        issuer ?? null,
        network ?? null,
        domain ?? null,
        telegramChannel ?? null,
        telegramLink ?? null,
        personName ?? null,
        personRole ?? null,
        now,
        id,
      );

    syncToSupabase(async () => {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
      if (domain !== undefined) patch.domain = domain;
      if (telegramChannel !== undefined) patch.telegram_channel = telegramChannel;
      if (telegramLink !== undefined) patch.telegram_link = telegramLink;
      if (personName !== undefined) patch.person_name = personName;
      if (personRole !== undefined) patch.person_role = personRole;
      await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }
```

with:

```typescript
    const { id, name, notes, assetCode, issuer, network, domain, telegramChannel, telegramLink, personId, clearPersonId } = body;

    if (isSupabaseOnly()) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
      if (domain !== undefined) patch.domain = domain;
      if (telegramChannel !== undefined) patch.telegram_channel = telegramChannel;
      if (telegramLink !== undefined) patch.telegram_link = telegramLink;
      if (clearPersonId) patch.person_id = null;
      else if (personId !== undefined) patch.person_id = personId;
      const { error } = await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
      if (error) {
        if (error.code === "23503") return NextResponse.json({ ok: false, error: "group_not_found" }, { status: 409 });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    getDb()
      .prepare(
        `UPDATE asset_groups SET
           name             = COALESCE(?, name),
           notes            = COALESCE(?, notes),
           asset_code       = COALESCE(?, asset_code),
           issuer           = COALESCE(?, issuer),
           network          = COALESCE(?, network),
           domain           = COALESCE(?, domain),
           telegram_channel = COALESCE(?, telegram_channel),
           telegram_link    = COALESCE(?, telegram_link),
           person_id        = COALESCE(?, person_id),
           updated_at       = ?
         WHERE id = ?`,
      )
      .run(
        name ?? null,
        notes ?? null,
        assetCode ?? null,
        issuer ?? null,
        network ?? null,
        domain ?? null,
        telegramChannel ?? null,
        telegramLink ?? null,
        personId ?? null,
        now,
        id,
      );
    if (clearPersonId) {
      getDb().prepare("UPDATE asset_groups SET person_id = NULL WHERE id = ?").run(id);
    }

    syncToSupabase(async () => {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
      if (domain !== undefined) patch.domain = domain;
      if (telegramChannel !== undefined) patch.telegram_channel = telegramChannel;
      if (telegramLink !== undefined) patch.telegram_link = telegramLink;
      if (clearPersonId) patch.person_id = null;
      else if (personId !== undefined) patch.person_id = personId;
      await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors remaining only in `hooks/use-asset-groups.ts` and `components/groups/GroupsPanel.tsx` (fixed in Tasks 6, 8).

- [ ] **Step 5: Commit**

```bash
git add app/api/db/groups/route.ts
git commit -m "feat(persons): replace personName/personRole wiring with person_id (set + explicit clear) in groups API route"
```

---

### Task 5: Persons hook

**Files:**
- Create: `hooks/use-persons.ts`

**Interfaces:**
- Consumes: `Person`, `PersonAddress` (Task 2), `/api/db/persons` (Task 3), `createDbCache`/`dbPost`/`dbPatch`/`authHeaders`/`debounce` (`lib/db-client.ts`).
- Produces: `usePersons()` returning `{ persons, isLoaded, createPerson, updatePerson, deletePerson, addPersonAddress, removePersonAddress }`, plus `getPersonsSnapshot()`/`isPersonsLoaded()` — consumed by Task 7 (Persons page) and Task 8 (GroupsPanel person picker).

- [ ] **Step 1: Write the hook, mirroring `hooks/use-asset-groups.ts`'s simpler entity+children shape (no client-id remapping needed — persons have no natural dedupe-by-identity like assetCode+issuer)**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, authHeaders, debounce } from "@/lib/db-client";
import type { Person, PersonAddress } from "@/lib/persons/types";

const ENDPOINT = "/api/db/persons";

function dbDeletePerson(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "person" }),
  }).catch(() => {});
}
function dbDeleteAddress(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "address" }),
  }).catch(() => {});
}
const _cache = createDbCache<Person>();

export function getPersonsSnapshot(): Person[] {
  return _cache.get();
}

export function isPersonsLoaded(): boolean {
  return _cache.isLoaded();
}

export function usePersons() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);

    const onFocus = debounce(() => _cache.reload(ENDPOINT), 2000);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const persons = _cache.get();

  const createPerson = useCallback((entry: { name: string; role?: string; notes?: string }): string => {
    const id = `per-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const nameTrimmed = entry.name.trim();
    const newPerson: Person = {
      id,
      name: nameTrimmed,
      role: entry.role?.trim() || undefined,
      notes: entry.notes?.trim() || undefined,
      addresses: [],
      createdAt: now,
      updatedAt: now,
    };
    _cache.set([newPerson, ..._cache.get()]);
    dbPost(ENDPOINT, { type: "person", id, name: nameTrimmed, role: entry.role, notes: entry.notes })
      .catch(() => _cache.reload(ENDPOINT));
    return id;
  }, []);

  const updatePerson = useCallback(
    (id: string, patch: Partial<Pick<Person, "name" | "role" | "notes">>) => {
      _cache.set(
        _cache.get().map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
      );
      dbPatch(ENDPOINT, { type: "person", id, ...patch }).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const deletePerson = useCallback((id: string) => {
    _cache.set(_cache.get().filter((p) => p.id !== id));
    dbDeletePerson(id);
  }, []);

  const addPersonAddress = useCallback(
    (personId: string, entry: { address: string; label?: string }) => {
      const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const newAddress: PersonAddress = { id, personId, address: entry.address, label: entry.label, addedAt: now };
      _cache.set(
        _cache.get().map((p) => {
          if (p.id !== personId) return p;
          const existing = p.addresses.findIndex((a) => a.address === entry.address);
          const addresses =
            existing >= 0
              ? p.addresses.map((a, i) => (i === existing ? { ...a, ...entry } : a))
              : [...p.addresses, newAddress];
          return { ...p, addresses, updatedAt: now };
        }),
      );
      dbPost(ENDPOINT, { type: "address", id, personId, ...entry }).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const removePersonAddress = useCallback((personId: string, addressId: string) => {
    _cache.set(
      _cache.get().map((p) =>
        p.id !== personId ? p : { ...p, addresses: p.addresses.filter((a) => a.id !== addressId) },
      ),
    );
    dbDeleteAddress(addressId);
  }, []);

  return {
    persons,
    isLoaded: _cache.isLoaded(),
    createPerson,
    updatePerson,
    deletePerson,
    addPersonAddress,
    removePersonAddress,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in this new file.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-persons.ts
git commit -m "feat(persons): add usePersons DB-cache hook"
```

---

### Task 6: Asset-groups hook — personId set/unlink

**Files:**
- Modify: `hooks/use-asset-groups.ts`

**Interfaces:**
- Consumes: `AssetGroup.personId` (Task 2), groups API `clearPersonId` flag (Task 4).
- Produces: `updateGroup` accepting `personId` (set), new `unlinkGroupPerson(groupId)` (clear) — consumed by Task 8.

- [ ] **Step 1: Replace `personName`/`personRole` with `personId` in `updateGroup`'s patch type**

Replace:

```typescript
      patch: Partial<
        Pick<
          AssetGroup,
          | "name"
          | "notes"
          | "assetCode"
          | "issuer"
          | "network"
          | "domain"
          | "telegramChannel"
          | "telegramLink"
          | "personName"
          | "personRole"
        >
      >,
```

with:

```typescript
      patch: Partial<
        Pick<
          AssetGroup,
          | "name"
          | "notes"
          | "assetCode"
          | "issuer"
          | "network"
          | "domain"
          | "telegramChannel"
          | "telegramLink"
          | "personId"
        >
      >,
```

- [ ] **Step 2: Add `unlinkGroupPerson` right after `updateGroup`**

Insert after the closing of `updateGroup` (right before `const deleteGroup = useCallback...`):

```typescript
  const unlinkGroupPerson = useCallback((id: string) => {
    _cache.set(
      _cache.get().map((g) => (g.id === id ? { ...g, personId: undefined, updatedAt: Date.now() } : g)),
    );
    const pending = _pendingGroupCreates.get(id) ?? Promise.resolve(id);
    pending
      .then((realId) => dbPatch(ENDPOINT, { type: "group", id: realId, clearPersonId: true }))
      .catch(() => _cache.reload(ENDPOINT));
  }, []);

```

- [ ] **Step 3: Export `unlinkGroupPerson` from the hook's return object**

Replace:

```typescript
  return {
    groups,
    isLoaded: _cache.isLoaded(),
    createGroup,
    updateGroup,
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
    waitForGroupId,
  };
```

with:

```typescript
  return {
    groups,
    isLoaded: _cache.isLoaded(),
    createGroup,
    updateGroup,
    unlinkGroupPerson,
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
    waitForGroupId,
  };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors remaining only in `components/groups/GroupsPanel.tsx` (fixed in Task 8).

- [ ] **Step 5: Commit**

```bash
git add hooks/use-asset-groups.ts
git commit -m "feat(persons): replace personName/personRole with personId in updateGroup, add unlinkGroupPerson"
```

---

### Task 7: Persons page + navigation + PersonsPanel

**Files:**
- Modify: `lib/navigation.ts`
- Create: `app/(data)/persons/page.tsx`
- Create: `components/persons/PersonsPanel.tsx`

**Interfaces:**
- Consumes: `usePersons()` (Task 5), `useAssetGroups()` (existing), `ShortAddress` (existing `components/shared`).
- Produces: `/persons` route.

- [ ] **Step 1: Add the nav entry**

In `lib/navigation.ts`, add `Contact` to the lucide-react import list:

Replace:

```typescript
  Users,
  Link2,
```

with:

```typescript
  Users,
  Contact,
  Link2,
```

Then add the menu item right after Asset Groups in the "My Data" section:

Replace:

```typescript
  {
    title: "Asset Groups",
    href: "/groups",
    icon: Layers,
  },
```

with:

```typescript
  {
    title: "Asset Groups",
    href: "/groups",
    icon: Layers,
  },
  {
    title: "Persons",
    href: "/persons",
    icon: Contact,
  },
```

- [ ] **Step 2: Create the page shell**

```tsx
// app/(data)/persons/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PersonsPanel } from "@/components/persons/PersonsPanel";

export default function PersonsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Persons</h1>
        <p className="text-muted-foreground mt-2">
          Attribute important people — CEOs, founders — to asset groups and addresses.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        }
      >
        <PersonsPanel />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Create the panel**

```tsx
// components/persons/PersonsPanel.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UserPlus, Trash2, Pencil, Check, X, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePersons } from "@/hooks/use-persons";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import type { Person } from "@/lib/persons/types";

function PersonCard({ person }: { person: Person }) {
  const { updatePerson, deletePerson, addPersonAddress, removePersonAddress } = usePersons();
  const { groups } = useAssetGroups();
  const { settings } = useSettings();

  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(person.name);
  const [roleVal, setRoleVal] = useState(person.role ?? "");
  const [notesVal, setNotesVal] = useState(person.notes ?? "");
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newAddressLabel, setNewAddressLabel] = useState("");

  const attributedGroups = groups.filter((g) => g.personId === person.id);

  function save() {
    updatePerson(person.id, {
      name: nameVal.trim() || person.name,
      role: roleVal.trim() || undefined,
      notes: notesVal.trim() || undefined,
    });
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex flex-col gap-2">
                <Input value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="h-7 text-sm font-semibold" autoFocus />
                <Input value={roleVal} onChange={(e) => setRoleVal(e.target.value)} className="h-7 text-xs" placeholder="Role (e.g. CEO)" />
                <Input value={notesVal} onChange={(e) => setNotesVal(e.target.value)} className="h-7 text-xs" placeholder="Notes" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={save}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  {person.name}
                  {person.role && <span className="text-muted-foreground font-normal ml-1.5">— {person.role}</span>}
                </CardTitle>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {!editing && person.notes && <p className="text-xs text-muted-foreground mt-1">{person.notes}</p>}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => {
              if (window.confirm(`Delete "${person.name}"? This unlinks them from ${attributedGroups.length} asset group(s) and removes their ${person.addresses.length} linked address(es).`)) {
                deletePerson(person.id);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Addresses</Label>
          <div className="space-y-1">
            {person.addresses.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <ShortAddress address={a.address} network={settings.network} />
                {a.label && <span className="text-muted-foreground">{a.label}</span>}
                <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => removePersonAddress(person.id, a.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          {addingAddress ? (
            <div className="flex gap-2">
              <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} className="text-xs font-mono" placeholder="G..." autoFocus />
              <Input value={newAddressLabel} onChange={(e) => setNewAddressLabel(e.target.value)} className="text-xs" placeholder="Label (optional)" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (newAddress.trim()) {
                    addPersonAddress(person.id, { address: newAddress.trim(), label: newAddressLabel.trim() || undefined });
                  }
                  setNewAddress("");
                  setNewAddressLabel("");
                  setAddingAddress(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setAddingAddress(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add address
            </Button>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Attributed to {attributedGroups.length} asset group(s)</Label>
          {attributedGroups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attributedGroups.map((g) => (
                <Link key={g.id} href={`/groups?open=${g.id}`} className="text-xs px-2 py-0.5 rounded-full bg-accent hover:bg-accent/70 transition-colors">
                  {g.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonsPanel() {
  const { persons, isLoaded, createPerson } = usePersons();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  if (!isLoaded) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. CEO)" />
            <Button
              onClick={() => {
                if (!name.trim()) return;
                createPerson({ name, role: role || undefined });
                setName("");
                setRole("");
              }}
            >
              <UserPlus className="h-4 w-4 mr-1.5" /> Add Person
            </Button>
          </div>
        </CardContent>
      </Card>
      {persons.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No persons yet — add one above.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {persons.map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  );
}
```

(`searchParams`/`?open=ID` deep-link scroll-into-view is intentionally NOT implemented in this first pass — `Asset Groups`' version of this took an extra pass to get right; land the basic list first, add deep-link parity as a quick follow-up once this is confirmed working, matching this project's step-by-step rule. Remove the unused `searchParams` variable if lint flags it — replace `const searchParams = useSearchParams();` line with nothing, and drop the `useSearchParams` import, since it's not otherwise used yet.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from these 3 files. If `searchParams` is unused, remove it and the import per the note above.

- [ ] **Step 5: Commit**

```bash
git add lib/navigation.ts "app/(data)/persons/page.tsx" components/persons/PersonsPanel.tsx
git commit -m "feat(persons): add /persons page, nav entry, and PersonsPanel"
```

---

### Task 8: GroupsPanel — replace free-text person editor with person picker/unlink

**Files:**
- Modify: `components/groups/GroupsPanel.tsx`

**Interfaces:**
- Consumes: `usePersons()` (Task 5), `updateGroup`/`unlinkGroupPerson` accepting `personId` (Task 6), `group.personId` (Task 2).

- [ ] **Step 1: Add imports**

Replace:

```typescript
import { useAssetGroups, waitForGroupId } from "@/hooks/use-asset-groups";
```

with:

```typescript
import { useAssetGroups, waitForGroupId } from "@/hooks/use-asset-groups";
import { usePersons } from "@/hooks/use-persons";
```

Add `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` to the ui imports — replace:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

with:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
```

Add `Link2` and `UserX` to the lucide-react import list already at the top of the file (used for the "+ Attribute Person" and unlink affordances) — replace:

```typescript
  Loader2,
  Send,
} from "lucide-react";
```

with:

```typescript
  Loader2,
  Send,
  UserX,
} from "lucide-react";
```

- [ ] **Step 2: Replace the `editingPerson`/`personNameVal`/`personRoleVal` state with a dialog-driven picker's state**

Replace:

```typescript
  const [editingPerson, setEditingPerson] = useState(false);
  const [personNameVal, setPersonNameVal] = useState(group.personName ?? "");
  const [personRoleVal, setPersonRoleVal] = useState(group.personRole ?? "");
```

with:

```typescript
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [newPersonMode, setNewPersonMode] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonRole, setNewPersonRole] = useState("");
```

- [ ] **Step 3: Pull in `usePersons()` and `unlinkGroupPerson` inside `GroupCard`**

Replace:

```typescript
  const {
    groups,
    updateGroup,
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
  } = useAssetGroups();
```

with:

```typescript
  const {
    groups,
    updateGroup,
    unlinkGroupPerson,
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
  } = useAssetGroups();
  const { persons, createPerson } = usePersons();
```

- [ ] **Step 4: Replace the Attributed Person section**

Replace:

```typescript
          {/* Attributed Person */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Attributed Person</Label>
            {editingPerson ? (
              <div className="flex gap-2">
                <Input
                  value={personNameVal}
                  onChange={(e) => setPersonNameVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="Name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { personName: personNameVal, personRole: personRoleVal });
                      setEditingPerson(false);
                    }
                    if (e.key === "Escape") {
                      setPersonNameVal(group.personName ?? "");
                      setPersonRoleVal(group.personRole ?? "");
                      setEditingPerson(false);
                    }
                  }}
                />
                <Input
                  value={personRoleVal}
                  onChange={(e) => setPersonRoleVal(e.target.value)}
                  className="text-xs"
                  placeholder="Role (e.g. CEO)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { personName: personNameVal, personRole: personRoleVal });
                      setEditingPerson(false);
                    }
                    if (e.key === "Escape") {
                      setPersonNameVal(group.personName ?? "");
                      setPersonRoleVal(group.personRole ?? "");
                      setEditingPerson(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { personName: personNameVal, personRole: personRoleVal });
                    setEditingPerson(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingPerson(true)}
              >
                {group.personName || group.personRole ? (
                  [group.personName, group.personRole].filter(Boolean).join(" — ")
                ) : (
                  <span className="italic">Add attributed person…</span>
                )}
              </Button>
            )}
          </div>
```

with:

```typescript
          {/* Attributed Person */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Attributed Person</Label>
            {group.personId ? (
              (() => {
                const person = persons.find((p) => p.id === group.personId);
                return (
                  <div className="flex items-center gap-2 text-xs">
                    <Link href={`/persons?open=${group.personId}`} className="hover:underline">
                      {person ? [person.name, person.role].filter(Boolean).join(" — ") : "Unknown person"}
                    </Link>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => unlinkGroupPerson(group.id)}>
                      <UserX className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })()
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setPersonDialogOpen(true)}
              >
                <span className="italic">+ Attribute Person</span>
              </Button>
            )}
          </div>

          <Dialog open={personDialogOpen} onOpenChange={(o) => { setPersonDialogOpen(o); if (!o) setNewPersonMode(false); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Attribute Person</DialogTitle>
              </DialogHeader>
              {newPersonMode ? (
                <div className="space-y-2">
                  <Input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="Name" autoFocus />
                  <Input value={newPersonRole} onChange={(e) => setNewPersonRole(e.target.value)} placeholder="Role (e.g. CEO)" />
                  <Button variant="ghost" size="sm" onClick={() => setNewPersonMode(false)}>
                    ← Pick existing person instead
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a person…" />
                    </SelectTrigger>
                    <SelectContent>
                      {persons.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {[p.name, p.role].filter(Boolean).join(" — ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => setNewPersonMode(true)}>
                    + New Person
                  </Button>
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPersonDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (newPersonMode) {
                      if (!newPersonName.trim()) return;
                      const id = createPerson({ name: newPersonName, role: newPersonRole || undefined });
                      updateGroup(group.id, { personId: id });
                      setNewPersonName("");
                      setNewPersonRole("");
                    } else if (selectedPersonId) {
                      updateGroup(group.id, { personId: selectedPersonId });
                    }
                    setNewPersonMode(false);
                    setPersonDialogOpen(false);
                  }}
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
```

- [ ] **Step 5: Add the `Link` import if not already present**

Check the top of the file for `import Link from "next/link";` — this component is inside `GroupsPanel.tsx`, which does not currently import `Link` (it uses `router.push` elsewhere, and plain `<Link>` from `next/link` for the "Manage wallets →"-style rows lives in other files, not this one). Add it:

Replace:

```typescript
import { useSearchParams, useRouter } from "next/navigation";
```

with:

```typescript
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

- [ ] **Step 7: Manual browser verification**

Run the same protocol as the prior two asset-groups rounds: check no enabled auto-send/tiered-reward groups first, `DB_PROVIDER="" npm run dev`, set the `sb-logged-in` cookie, navigate to `/groups`.

1. Open `/persons`. Add a person (name + role). Confirm it appears in the list.
2. Add an address to that person. Confirm it renders via `ShortAddress`.
3. Go to `/groups`, expand any card, click "+ Attribute Person", pick the person just created, Save. Confirm the card now shows `"{name} — {role}"` linking to `/persons?open={id}`.
4. Reload — confirm the link persisted.
5. Click the unlink (X) button. Confirm it reverts to "+ Attribute Person".
6. Back on `/persons`, re-attribute the same person to the group, then check the person's card shows "Attributed to 1 asset group(s)" with a link back to that group.
7. Test the inline "+ New Person" path from inside the Asset Group dialog directly (skip the `/persons` page) — create a second person that way, confirm it also appears on `/persons` afterward.
8. Delete the test person from `/persons`. Confirm the asset group's attribution reverts to "+ Attribute Person" (FK `ON DELETE SET NULL` took effect) rather than erroring.
9. Clean up: remove the test person/address left over from this test if any real-data groups were used.

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: same 165/166 passing as before (the 1 pre-existing unrelated `asset-creator/preflight.test.ts` failure) — no regressions from this change.

- [ ] **Step 9: Commit**

```bash
git add components/groups/GroupsPanel.tsx
git commit -m "feat(persons): replace free-text person editor with person picker + unlink in GroupsPanel"
```

---

## Post-implementation

Add a new Module Inventory row for `persons` (Working, awaiting sign-off) and a short `## Persons` section to `CLAUDE.md`, following the terse style of existing module sections — route, panel, lib files, the person↔group single-FK constraint, the person↔address direct-link capability, and the `ON DELETE SET NULL`/`ON DELETE CASCADE` cleanup behavior on person delete. Also update the existing `## Asset Groups` section's "Attributed person" bullet (added earlier this session) to point at the new `/persons` module instead of describing the now-removed free-text fields.
