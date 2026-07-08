# Asset Group Person Attribution + Telegram Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `personName`/`personRole` fields to Asset Groups (edited together as one unit), and make the Telegram channel name visible as header text instead of icon-only.

**Architecture:** Two more flat nullable `TEXT` columns on `asset_groups`, threaded through the same SQLite/Supabase dual-mode API route and DB-cache hook as `domain`/`telegramChannel`/`telegramLink`. UI editor combines both fields into one save action (mirrors the existing member-edit multi-field pattern) rather than one-row-per-field, since name+role are a single concept. No new pure-logic module — display formatting is a one-line join, not worth a separate tested file.

**Tech Stack:** Same as prior asset-groups work — Next.js API routes, better-sqlite3, Supabase, React.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-asset-group-person-attribution-design.md`
- Both fields optional and independent.
- Schema change touches both `lib/db.ts` and `supabase-schema.sql` in the same task.
- No clustering/grouping view in this pass.

---

### Task 1: Schema — `person_name`, `person_role` columns

**Files:**
- Modify: `lib/db.ts` (CREATE TABLE for `asset_groups`, and the migration block added for domain/telegram)
- Modify: `supabase-schema.sql`

**Interfaces:**
- Produces: 2 new nullable TEXT columns on `asset_groups`, consumed by Task 2 (types) and Task 3 (API route).

- [ ] **Step 1: Update the CREATE TABLE statement**

In `lib/db.ts`, replace:

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
      person_name      TEXT,
      person_role      TEXT,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
```

- [ ] **Step 2: Add the migration block**

In `lib/db.ts`, right after the asset-groups domain/telegram migration block:

```typescript
  // ── Asset groups migration: add domain/telegram columns if missing ────────
  const assetGroupCols = (db.pragma("table_info(asset_groups)") as { name: string }[]).map((c) => c.name);
  if (!assetGroupCols.includes("domain")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN domain TEXT`);
  }
  if (!assetGroupCols.includes("telegram_channel")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN telegram_channel TEXT`);
  }
  if (!assetGroupCols.includes("telegram_link")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN telegram_link TEXT`);
  }
```

add:

```typescript
  if (!assetGroupCols.includes("person_name")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN person_name TEXT`);
  }
  if (!assetGroupCols.includes("person_role")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN person_role TEXT`);
  }
```

- [ ] **Step 3: Update `supabase-schema.sql`**

Find the `asset_groups` CREATE TABLE line (contains `telegram_link TEXT,`) and add `person_name TEXT, person_role TEXT,` immediately after `telegram_link TEXT,` in that line.

- [ ] **Step 4: Verify the migration runs cleanly**

Run: `npx tsx -e "import { getDb } from './lib/db'; console.log(getDb().pragma('table_info(asset_groups)'))"`
Expected: printed array includes `person_name` and `person_role` columns.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts supabase-schema.sql
git commit -m "feat(asset-groups): add person_name/person_role columns"
```

---

### Task 2: Types

**Files:**
- Modify: `lib/asset-groups/types.ts`

**Interfaces:**
- Produces: `AssetGroup.personName?: string`, `AssetGroup.personRole?: string` — consumed by Task 3, 4, 5.

- [ ] **Step 1: Update the `AssetGroup` interface**

Replace:

```typescript
  domain?: string;
  telegramChannel?: string;
  telegramLink?: string;
  createdAt: number;
```

with:

```typescript
  domain?: string;
  telegramChannel?: string;
  telegramLink?: string;
  personName?: string;
  personRole?: string;
  createdAt: number;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/asset-groups/types.ts
git commit -m "feat(asset-groups): add personName/personRole to AssetGroup type"
```

---

### Task 3: API route wiring

**Files:**
- Modify: `app/api/db/groups/route.ts` (`rowToGroup`, POST insert, PATCH)

**Interfaces:**
- Consumes: `AssetGroup.personName/personRole` (Task 2).
- Produces: GET/POST/PATCH round-trip the 2 fields — consumed by Task 4.

- [ ] **Step 1: Update `rowToGroup`**

Replace:

```typescript
    domain: (r.domain as string) ?? undefined,
    telegramChannel: (r.telegram_channel as string) ?? undefined,
    telegramLink: (r.telegram_link as string) ?? undefined,
    createdAt: r.created_at as number,
```

with:

```typescript
    domain: (r.domain as string) ?? undefined,
    telegramChannel: (r.telegram_channel as string) ?? undefined,
    telegramLink: (r.telegram_link as string) ?? undefined,
    personName: (r.person_name as string) ?? undefined,
    personRole: (r.person_role as string) ?? undefined,
    createdAt: r.created_at as number,
```

- [ ] **Step 2: Update the SQLite POST insert**

Replace:

```typescript
        db.prepare(
          `INSERT INTO asset_groups (id, name, asset_code, issuer, network, notes, domain, telegram_channel, telegram_link, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name       = excluded.name,
             asset_code = excluded.asset_code,
             issuer     = excluded.issuer,
             network    = excluded.network,
             notes      = excluded.notes,
             updated_at = excluded.updated_at`,
        ).run(id, nameTrimmed, assetCodeNorm, issuerNorm, networkNorm, notes ?? null, null, null, null, now, now);
```

with:

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

(Same reasoning as `domain`/`telegram*`: not part of the create form, edited post-creation only via PATCH, and the `ON CONFLICT` clause intentionally does not touch these columns so re-running group creation never clobbers a value the user already edited.)

- [ ] **Step 3: Update PATCH (both SQLite and Supabase branches)**

Replace:

```typescript
  if (body.type === "group") {
    const { id, name, notes, assetCode, issuer, network, domain, telegramChannel, telegramLink } = body;

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
      await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }
```

with:

```typescript
  if (body.type === "group") {
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

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/db/groups/route.ts
git commit -m "feat(asset-groups): thread personName/personRole through groups API route"
```

---

### Task 4: Hook wiring

**Files:**
- Modify: `hooks/use-asset-groups.ts` (`updateGroup`)

- [ ] **Step 1: Extend the `updateGroup` patch type**

Replace:

```typescript
      patch: Partial<
        Pick<
          AssetGroup,
          "name" | "notes" | "assetCode" | "issuer" | "network" | "domain" | "telegramChannel" | "telegramLink"
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
          | "personName"
          | "personRole"
        >
      >,
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-asset-groups.ts
git commit -m "feat(asset-groups): allow updateGroup to patch personName/personRole"
```

---

### Task 5: UI — combined person editor + Telegram header text

**Files:**
- Modify: `components/groups/GroupsPanel.tsx`

**Interfaces:**
- Consumes: `updateGroup` accepting `personName`/`personRole` (Task 4), `group.personName`/`group.personRole`/`group.telegramChannel` (Task 2).

- [ ] **Step 1: Add state for the combined person editor**

Replace:

```typescript
  const [editingTelegramLink, setEditingTelegramLink] = useState(false);
  const [telegramLinkVal, setTelegramLinkVal] = useState(group.telegramLink ?? "");
```

with:

```typescript
  const [editingTelegramLink, setEditingTelegramLink] = useState(false);
  const [telegramLinkVal, setTelegramLinkVal] = useState(group.telegramLink ?? "");
  const [editingPerson, setEditingPerson] = useState(false);
  const [personNameVal, setPersonNameVal] = useState(group.personName ?? "");
  const [personRoleVal, setPersonRoleVal] = useState(group.personRole ?? "");
```

- [ ] **Step 2: Change the Telegram header link from icon-only to icon + text**

Replace:

```typescript
                {resolveTelegramUrl(group.telegramChannel, group.telegramLink) && (
                  <a
                    href={resolveTelegramUrl(group.telegramChannel, group.telegramLink)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={group.telegramChannel || "Telegram"}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </a>
                )}
```

with:

```typescript
                {resolveTelegramUrl(group.telegramChannel, group.telegramLink) && (
                  <a
                    href={resolveTelegramUrl(group.telegramChannel, group.telegramLink)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={group.telegramChannel || "Telegram"}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {group.telegramChannel && <span>@{group.telegramChannel.replace(/^[@/]+/, "")}</span>}
                  </a>
                )}
```

(No text shown when only `telegramLink` is set without a channel name — nothing meaningful to display as a label in that case, icon + tooltip still works exactly as before.)

- [ ] **Step 3: Add the combined Attributed Person editor below Telegram Link**

Replace:

```typescript
                {group.telegramLink || <span className="italic">Add Telegram link…</span>}
              </Button>
            )}
          </div>

          {/* Members table */}
```

with:

```typescript
                {group.telegramLink || <span className="italic">Add Telegram link…</span>}
              </Button>
            )}
          </div>

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

          {/* Members table */}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual browser verification**

Run: `DB_PROVIDER="" npm run dev` (bypasses the Supabase auth gate for local-only testing, per the pattern used for the prior asset-groups feature — first check `sqlite3 stellar-toolkit.db "SELECT id FROM auto_send_groups WHERE enabled=1;"` and the tiered-rewards equivalent return nothing, so no real scheduled payments fire).

1. Open `/groups` (set `document.cookie = "sb-logged-in=1"` via browser eval first to pass the page-level redirect gate).
2. Expand any group card. Click "Add attributed person…", type a name and a role, press Enter. Confirm the row displays `"Name — Role"`.
3. Set a Telegram channel name (if not already set from prior testing). Confirm the header now shows the paper-plane icon followed by `@channelname` as visible text, not just an icon.
4. Reload. Confirm the person name/role and Telegram text both persisted.
5. Clear the person fields back to empty (this is real user data — clean up test values same as the previous round).

- [ ] **Step 6: Commit**

```bash
git add components/groups/GroupsPanel.tsx
git commit -m "feat(asset-groups): add attributed-person editor, show Telegram channel name in header"
```

---

## Post-implementation

Add a one-line note to CLAUDE.md's Asset Groups section: group cards now also support `personName`/`personRole` (combined single-editor pattern, unlike the one-row-per-field Notes/domain/Telegram fields), and the Telegram header link shows the channel name as text.
