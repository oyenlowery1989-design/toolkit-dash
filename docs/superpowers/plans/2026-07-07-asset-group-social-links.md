# Asset Group Social Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 optional group-level fields to Asset Groups — `domain` (public website), `telegramChannel`, `telegramLink` — editable inline in the expanded card (same pattern as the existing Notes field) and surfaced as clickable icon links in the collapsed card header.

**Architecture:** Flat nullable `TEXT` columns on `asset_groups`, threaded through the existing SQLite/Supabase dual-mode API route and DB-cache hook exactly like `notes`. A small pure-function module derives display URLs (domain gets `https://` prefixed if missing a scheme; Telegram link wins over channel name, channel name alone derives a `t.me/` URL) — this is the only logic worth unit-testing, everything else is mechanical plumbing that mirrors `notes` field-for-field.

**Tech Stack:** Next.js API routes, better-sqlite3, Supabase, React (no component test harness in this repo — vitest only covers `lib/**` and `hooks/**`, per `vitest.config.ts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-asset-group-social-links-design.md`
- All 3 fields optional and independent — no field requires another to be set.
- No format validation blocks save (free text, like `notes`).
- Schema change must touch both `lib/db.ts` (SQLite) and `supabase-schema.sql` (Supabase) in the same task — project convention, a past module shipped with these out of sync and broke Vercel deploys.
- No new "Social Links" grouped mini-form — 3 independent inline-editable rows, matching the existing Notes editor pattern exactly.

---

### Task 1: Pure URL-derivation helpers

**Files:**
- Create: `lib/asset-groups/links.ts`
- Test: `tests/lib/asset-group-links.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no dependencies).
- Produces: `normalizeExternalUrl(raw: string): string` and `resolveTelegramUrl(channel?: string, link?: string): string | undefined` — both imported by `components/groups/GroupsPanel.tsx` in Task 6.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/asset-group-links.test.ts
import { describe, it, expect } from "vitest";
import { normalizeExternalUrl, resolveTelegramUrl } from "@/lib/asset-groups/links";

describe("normalizeExternalUrl", () => {
  it("prefixes https:// when no scheme is present", () => {
    expect(normalizeExternalUrl("example.com")).toBe("https://example.com");
  });

  it("leaves an existing https:// scheme untouched", () => {
    expect(normalizeExternalUrl("https://example.com")).toBe("https://example.com");
  });

  it("leaves an existing http:// scheme untouched", () => {
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com");
  });

  it("trims whitespace before checking for a scheme", () => {
    expect(normalizeExternalUrl("  example.com  ")).toBe("https://example.com");
  });
});

describe("resolveTelegramUrl", () => {
  it("returns undefined when both channel and link are unset", () => {
    expect(resolveTelegramUrl(undefined, undefined)).toBeUndefined();
  });

  it("returns undefined when both are empty strings", () => {
    expect(resolveTelegramUrl("", "")).toBeUndefined();
  });

  it("derives a t.me URL from the channel name alone", () => {
    expect(resolveTelegramUrl("mychannel", undefined)).toBe("https://t.me/mychannel");
  });

  it("strips a leading @ from the channel name", () => {
    expect(resolveTelegramUrl("@mychannel", undefined)).toBe("https://t.me/mychannel");
  });

  it("prefers the explicit link over a derived channel URL", () => {
    expect(resolveTelegramUrl("ignored", "https://t.me/real")).toBe("https://t.me/real");
  });

  it("normalizes a scheme-less explicit link", () => {
    expect(resolveTelegramUrl(undefined, "t.me/mychannel")).toBe("https://t.me/mychannel");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/asset-group-links.test.ts`
Expected: FAIL — `Cannot find module '@/lib/asset-groups/links'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/asset-groups/links.ts

/** Prefixes a bare domain/URL with https:// if it has no scheme. */
export function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Resolves the URL to link to for a group's Telegram presence.
 * An explicit link always wins; otherwise derives a t.me URL from the
 * channel name. Returns undefined if neither field is set.
 */
export function resolveTelegramUrl(channel?: string, link?: string): string | undefined {
  const linkTrimmed = link?.trim();
  if (linkTrimmed) return normalizeExternalUrl(linkTrimmed);

  const channelTrimmed = channel?.trim();
  if (!channelTrimmed) return undefined;
  return `https://t.me/${channelTrimmed.replace(/^[@/]+/, "")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/asset-group-links.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/asset-groups/links.ts tests/lib/asset-group-links.test.ts
git commit -m "feat(asset-groups): add domain/telegram URL derivation helpers"
```

---

### Task 2: Schema — `domain`, `telegram_channel`, `telegram_link` columns

**Files:**
- Modify: `lib/db.ts:112-121` (CREATE TABLE) and `lib/db.ts:484-488` (add migration block right after)
- Modify: `supabase-schema.sql:15`

**Interfaces:**
- Consumes: nothing.
- Produces: 3 new nullable TEXT columns (`domain`, `telegram_channel`, `telegram_link`) on `asset_groups`, consumed by Task 3 (types) and Task 4 (API route).

- [ ] **Step 1: Update the CREATE TABLE statement for fresh installs**

In `lib/db.ts`, replace:

```typescript
    CREATE TABLE IF NOT EXISTS asset_groups (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      asset_code  TEXT,
      issuer      TEXT,
      network     TEXT    NOT NULL DEFAULT 'public',
      notes       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
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
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
```

- [ ] **Step 2: Add the migration block for existing databases**

In `lib/db.ts`, right after the known-creators migration block:

```typescript
  // ── Known creators migration: add parent_address column if missing ────────
  const creatorCols = (db.pragma("table_info(known_creators)") as { name: string }[]).map((c) => c.name);
  if (!creatorCols.includes("parent_address")) {
    db.exec(`ALTER TABLE known_creators ADD COLUMN parent_address TEXT`);
  }
```

add:

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

- [ ] **Step 3: Update `supabase-schema.sql`**

Replace:

```sql
CREATE TABLE IF NOT EXISTS asset_groups (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, asset_code TEXT, issuer TEXT, network TEXT NOT NULL DEFAULT 'public', notes TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
```

with:

```sql
CREATE TABLE IF NOT EXISTS asset_groups (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, asset_code TEXT, issuer TEXT, network TEXT NOT NULL DEFAULT 'public', notes TEXT, domain TEXT, telegram_channel TEXT, telegram_link TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
```

- [ ] **Step 4: Verify the migration runs cleanly against the existing local DB**

Run: `node -e "const {getDb}=require('./lib/db.ts')" 2>&1 || true` will not work directly (TS) — instead start the dev server briefly and check columns:

Run: `npm run dev &` then after it logs ready, in another shell:
`sqlite3 stellar-toolkit.db "PRAGMA table_info(asset_groups);"`
Expected: output includes rows for `domain`, `telegram_channel`, `telegram_link`. Stop the dev server after (`kill %1` or Ctrl-C).

If `sqlite3` CLI isn't installed, alternatively run `npx tsx -e "import { getDb } from './lib/db'; console.log(getDb().pragma('table_info(asset_groups)'))"` and confirm the 3 columns appear in the printed array.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts supabase-schema.sql
git commit -m "feat(asset-groups): add domain/telegram_channel/telegram_link columns"
```

---

### Task 3: Types

**Files:**
- Modify: `lib/asset-groups/types.ts:47-57`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AssetGroup.domain?: string`, `AssetGroup.telegramChannel?: string`, `AssetGroup.telegramLink?: string` — consumed by Task 4 (API route), Task 5 (hook), Task 6 (UI).

- [ ] **Step 1: Update the `AssetGroup` interface**

Replace:

```typescript
export interface AssetGroup {
  id: string;
  name: string;
  assetCode?: string;
  issuer?: string;
  network: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  members: GroupMember[];
}
```

with:

```typescript
export interface AssetGroup {
  id: string;
  name: string;
  assetCode?: string;
  issuer?: string;
  network: string;
  notes?: string;
  domain?: string;
  telegramChannel?: string;
  telegramLink?: string;
  createdAt: number;
  updatedAt: number;
  members: GroupMember[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (this is a superset-only change; existing code that builds `AssetGroup` objects doesn't need these fields since they're optional).

- [ ] **Step 3: Commit**

```bash
git add lib/asset-groups/types.ts
git commit -m "feat(asset-groups): add domain/telegramChannel/telegramLink to AssetGroup type"
```

---

### Task 4: API route wiring

**Files:**
- Modify: `app/api/db/groups/route.ts` (four spots: `rowToGroup`, POST insert, POST's Supabase-only insert, PATCH)

**Interfaces:**
- Consumes: `AssetGroup.domain/telegramChannel/telegramLink` (Task 3).
- Produces: GET/POST/PATCH on `/api/db/groups` now round-trip the 3 fields — consumed by Task 5 (hook).

- [ ] **Step 1: Update `rowToGroup`**

Replace:

```typescript
function rowToGroup(r: GroupRow, members: GroupMember[]): AssetGroup {
  return {
    id: r.id as string,
    name: r.name as string,
    assetCode: (r.asset_code as string) ?? undefined,
    issuer: (r.issuer as string) ?? undefined,
    network: r.network as string,
    notes: (r.notes as string) ?? undefined,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    members,
  };
}
```

with:

```typescript
function rowToGroup(r: GroupRow, members: GroupMember[]): AssetGroup {
  return {
    id: r.id as string,
    name: r.name as string,
    assetCode: (r.asset_code as string) ?? undefined,
    issuer: (r.issuer as string) ?? undefined,
    network: r.network as string,
    notes: (r.notes as string) ?? undefined,
    domain: (r.domain as string) ?? undefined,
    telegramChannel: (r.telegram_channel as string) ?? undefined,
    telegramLink: (r.telegram_link as string) ?? undefined,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    members,
  };
}
```

- [ ] **Step 2: Update the SQLite POST insert**

Replace:

```typescript
      try {
        db.prepare(
          `INSERT INTO asset_groups (id, name, asset_code, issuer, network, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name       = excluded.name,
             asset_code = excluded.asset_code,
             issuer     = excluded.issuer,
             network    = excluded.network,
             notes      = excluded.notes,
             updated_at = excluded.updated_at`,
        ).run(id, nameTrimmed, assetCodeNorm, issuerNorm, networkNorm, notes ?? null, now, now);

        syncToSupabase(async () => {
          await getSupabase()!.from("asset_groups").upsert({
            id,
            user_id: userId,
            name: nameTrimmed,
            asset_code: assetCodeNorm,
            issuer: issuerNorm,
            network: networkNorm,
            notes: notes ?? null,
            created_at: now,
            updated_at: now,
          });
        });
```

with (note: `domain`/`telegramChannel`/`telegramLink` are not part of the create form per the design — this task only wires the read/patch path, and the insert stores `null` for a brand-new group, which is what `notes` already did before the UI added a notes-at-create field, so this matches the destructure at line 87 unchanged):

```typescript
      try {
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

        syncToSupabase(async () => {
          await getSupabase()!.from("asset_groups").upsert({
            id,
            user_id: userId,
            name: nameTrimmed,
            asset_code: assetCodeNorm,
            issuer: issuerNorm,
            network: networkNorm,
            notes: notes ?? null,
            created_at: now,
            updated_at: now,
          });
        });
```

(The `ON CONFLICT` clause intentionally does not touch `domain`/`telegram_channel`/`telegram_link` — a re-run of group creation, e.g. the dedupe-by-asset-identity path, must not clobber values a user already edited via PATCH.)

- [ ] **Step 3: Update the Supabase-only POST insert**

Replace:

```typescript
      const { error } = await sb.from("asset_groups").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        asset_code: assetCodeNorm,
        issuer: issuerNorm,
        network: networkNorm,
        notes: notes ?? null,
        created_at: now,
        updated_at: now,
      });
```

with (unchanged — same reasoning as Step 2, these fields are edited post-creation only, so the create payload never sets them and Supabase's default `NULL` applies):

```typescript
      const { error } = await sb.from("asset_groups").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        asset_code: assetCodeNorm,
        issuer: issuerNorm,
        network: networkNorm,
        notes: notes ?? null,
        created_at: now,
        updated_at: now,
      });
```

No change needed here — leave as-is. (Listed to confirm no action, not a step to skip verifying.)

- [ ] **Step 4: Update PATCH (both SQLite and Supabase branches)**

Replace:

```typescript
  if (body.type === "group") {
    const { id, name, notes, assetCode, issuer, network } = body;

    if (isSupabaseOnly()) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
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
           name       = COALESCE(?, name),
           notes      = COALESCE(?, notes),
           asset_code = COALESCE(?, asset_code),
           issuer     = COALESCE(?, issuer),
           network    = COALESCE(?, network),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(name ?? null, notes ?? null, assetCode ?? null, issuer ?? null, network ?? null, now, id);

    syncToSupabase(async () => {
      const patch: Record<string, unknown> = { updated_at: now };
      if (name !== undefined) patch.name = name;
      if (notes !== undefined) patch.notes = notes;
      if (assetCode !== undefined) patch.asset_code = assetCode;
      if (issuer !== undefined) patch.issuer = issuer;
      if (network !== undefined) patch.network = network;
      await getSupabase()!.from("asset_groups").update(patch).eq("id", id).eq("user_id", userId!);
    });

    return NextResponse.json({ ok: true });
  }
```

with:

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

> Note: this `COALESCE`-based UPDATE means sending an **empty string** clears a field back to blank display (falsy but non-null propagates through `?? null` only for `undefined`/`null` inputs — the hook in Task 5 sends `undefined` when a field should stay unchanged, and `""` when the user clears the input, matching the exact convention `notes` already uses via `notesVal.trim() || undefined` at the call site... but check Task 6: the click-to-edit rows call `updateGroup(group.id, { domain: domainVal })` directly without `|| undefined`, exactly mirroring the existing Notes editor's `updateGroup(group.id, { notes: notesVal })` call, which also does not trim-or-undefined at that call site — so behavior is identical to existing Notes.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/db/groups/route.ts
git commit -m "feat(asset-groups): thread domain/telegram fields through groups API route"
```

---

### Task 5: Hook wiring

**Files:**
- Modify: `hooks/use-asset-groups.ts:172-203` (`updateGroup`)

**Interfaces:**
- Consumes: `AssetGroup.domain/telegramChannel/telegramLink` (Task 3), PATCH endpoint accepting those fields (Task 4).
- Produces: `updateGroup(id, { domain?, telegramChannel?, telegramLink? })` — consumed by Task 6 (UI).

- [ ] **Step 1: Extend the `updateGroup` patch type**

Replace:

```typescript
  const updateGroup = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<AssetGroup, "name" | "notes" | "assetCode" | "issuer" | "network">
      >,
    ) => {
```

with:

```typescript
  const updateGroup = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          AssetGroup,
          "name" | "notes" | "assetCode" | "issuer" | "network" | "domain" | "telegramChannel" | "telegramLink"
        >
      >,
    ) => {
```

(Everything else in `updateGroup` — the optimistic cache update, the `dbPatch` call — already spreads `patch` generically, so no further change is needed in this function body.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-asset-groups.ts
git commit -m "feat(asset-groups): allow updateGroup to patch domain/telegram fields"
```

---

### Task 6: UI — inline-editable rows + header icon links

**Files:**
- Modify: `components/groups/GroupsPanel.tsx` (imports, per-card state block, card header, CardContent below Notes)

**Interfaces:**
- Consumes: `normalizeExternalUrl`/`resolveTelegramUrl` (Task 1), `updateGroup` accepting the 3 fields (Task 5), `group.domain`/`group.telegramChannel`/`group.telegramLink` (Task 3).
- Produces: none (leaf UI).

- [ ] **Step 1: Add the `Send` icon import and the helper import**

Replace:

```typescript
import {
  Layers,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Globe,
  ExternalLink,
  UserPlus,
  KeyRound,
  Zap,
  Wallet,
  Loader2,
} from "lucide-react";
```

with:

```typescript
import {
  Layers,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Globe,
  ExternalLink,
  UserPlus,
  KeyRound,
  Zap,
  Wallet,
  Loader2,
  Send,
} from "lucide-react";
```

Add, near the other `@/lib` imports (after the `ROLE_LABELS, ROLE_COLORS` import):

```typescript
import { normalizeExternalUrl, resolveTelegramUrl } from "@/lib/asset-groups/links";
```

- [ ] **Step 2: Add state for the 3 new editable fields**

Replace:

```typescript
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(group.notes ?? "");
```

with:

```typescript
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(group.notes ?? "");
  const [editingDomain, setEditingDomain] = useState(false);
  const [domainVal, setDomainVal] = useState(group.domain ?? "");
  const [editingTelegramChannel, setEditingTelegramChannel] = useState(false);
  const [telegramChannelVal, setTelegramChannelVal] = useState(group.telegramChannel ?? "");
  const [editingTelegramLink, setEditingTelegramLink] = useState(false);
  const [telegramLinkVal, setTelegramLinkVal] = useState(group.telegramLink ?? "");
```

- [ ] **Step 3: Add header icon links next to the group name**

Replace:

```typescript
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setEditingName(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
```

with:

```typescript
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setEditingName(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {group.domain && (
                  <a
                    href={normalizeExternalUrl(group.domain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={group.domain}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </a>
                )}
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
              </div>
            )}
```

- [ ] **Step 4: Add the 3 inline-editable rows below Investigation Notes**

Replace:

```typescript
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingNotes(true)}
              >
                {group.notes || (
                  <span className="italic">Add investigation notes…</span>
                )}
              </Button>
            )}
          </div>

          {/* Members table */}
```

with:

```typescript
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingNotes(true)}
              >
                {group.notes || (
                  <span className="italic">Add investigation notes…</span>
                )}
              </Button>
            )}
          </div>

          {/* Website */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Website</Label>
            {editingDomain ? (
              <div className="flex gap-2">
                <Input
                  value={domainVal}
                  onChange={(e) => setDomainVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="example.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { domain: domainVal });
                      setEditingDomain(false);
                    }
                    if (e.key === "Escape") {
                      setDomainVal(group.domain ?? "");
                      setEditingDomain(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { domain: domainVal });
                    setEditingDomain(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingDomain(true)}
              >
                {group.domain || <span className="italic">Add website…</span>}
              </Button>
            )}
          </div>

          {/* Telegram Channel */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Telegram Channel</Label>
            {editingTelegramChannel ? (
              <div className="flex gap-2">
                <Input
                  value={telegramChannelVal}
                  onChange={(e) => setTelegramChannelVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="channelname"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { telegramChannel: telegramChannelVal });
                      setEditingTelegramChannel(false);
                    }
                    if (e.key === "Escape") {
                      setTelegramChannelVal(group.telegramChannel ?? "");
                      setEditingTelegramChannel(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { telegramChannel: telegramChannelVal });
                    setEditingTelegramChannel(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingTelegramChannel(true)}
              >
                {group.telegramChannel || <span className="italic">Add Telegram channel…</span>}
              </Button>
            )}
          </div>

          {/* Telegram Link */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Telegram Link</Label>
            {editingTelegramLink ? (
              <div className="flex gap-2">
                <Input
                  value={telegramLinkVal}
                  onChange={(e) => setTelegramLinkVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="t.me/channelname"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { telegramLink: telegramLinkVal });
                      setEditingTelegramLink(false);
                    }
                    if (e.key === "Escape") {
                      setTelegramLinkVal(group.telegramLink ?? "");
                      setEditingTelegramLink(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { telegramLink: telegramLinkVal });
                    setEditingTelegramLink(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingTelegramLink(true)}
              >
                {group.telegramLink || <span className="italic">Add Telegram link…</span>}
              </Button>
            )}
          </div>

          {/* Members table */}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual browser verification**

Run: `npm run dev`, open the Groups page in a browser (check `lib/navigation.ts` or the sidebar for the exact route — it's `/groups`).

1. Expand any existing group card.
2. Click "Add website…", type `example.com`, press Enter. Confirm it displays `example.com` and a Globe icon appears next to the group name in the collapsed header. Click the Globe icon, confirm it opens `https://example.com` in a new tab.
3. Click "Add Telegram channel…", type `stellarorg`, press Enter. Confirm a paper-plane (Send) icon appears in the header, and clicking it opens `https://t.me/stellarorg`.
4. Click into "Telegram Link", type `https://t.me/differentchannel`, press Enter. Confirm the header icon now opens the explicit link instead of the derived one (link wins over channel name).
5. Reload the page. Confirm all 3 values persisted (round-tripped through the DB).
6. Collapse the card. Confirm the Globe/Send icons still show in the collapsed header without needing to expand.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `asset-group-links.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add components/groups/GroupsPanel.tsx
git commit -m "feat(asset-groups): add domain/Telegram inline editors and header links"
```

---

## Post-implementation

Update `CLAUDE.md`'s Asset Groups section with a one-line note: group cards now support `domain`/`telegramChannel`/`telegramLink` metadata, editable via the same inline-editor pattern as Notes, surfaced as header icon links via `lib/asset-groups/links.ts`.
