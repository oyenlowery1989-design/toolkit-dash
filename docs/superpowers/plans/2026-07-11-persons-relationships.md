# Persons: Telegram Fields, Address→Group Membership, Relationships — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Telegram username field + derived Telegram-channel pills to Persons, show which asset groups each linked address independently belongs to, and add typed person-to-person relationships (friend/colleague/invited-by) with a connected-clusters view.

**Architecture:** Three new pure `lib/persons/*` helpers (unit-tested with vitest), one new DB table (`person_relationships`) added to both SQLite (`lib/db.ts`) and Supabase (`supabase-schema.sql`), the existing `/api/db/persons` route extended (not split) to serve the new fields/table, `hooks/use-persons.ts` extended with relationship mutations, and `PersonCard` extracted into its own file and grown with the new UI. No new API route — relationships are nested onto `Person.relationships` in the existing GET response, matching how `person_addresses` is already nested.

**Tech Stack:** Next.js App Router, TypeScript, better-sqlite3 (local) / Supabase Postgres (deployed), vitest for pure-function tests, shadcn/ui components.

## Global Constraints

- Never use `localStorage` for this data — DB-backed only, per project convention.
- Any new SQLite table must also exist in `supabase-schema.sql` in the same task (a table missing from one silently breaks Vercel deploys — this has happened before in this project).
- Follow the `isSupabaseOnly()` dual-mode pattern in every route change — every branch needs both a SQLite path and a Supabase path.
- `ShortAddress` badge/resolver logic (`lib/address-resolver.ts`) must not change — the new address→group lookup (Task 2) is additive and separate.
- No raw HTML `<button>`/`<input>`/`<select>` in any new UI — use `@/components/ui/*`.
- No component test harness exists in this repo (no `@testing-library/react`) — UI tasks are verified via `npx tsc --noEmit` plus the final manual browser check in Task 13, matching existing project convention.

---

### Task 1: Types + shared `normalizeChannel` extraction

**Files:**
- Modify: `lib/persons/types.ts`
- Modify: `lib/asset-groups/links.ts`
- Modify: `components/persons/TelegramChannelClusters.tsx`
- Modify: `tests/lib/asset-group-links.test.ts`

**Interfaces:**
- Produces: `PersonRelationshipType` (`"friend" | "colleague" | "invited_by"`), `PersonRelationshipRef { id, personId, type, direction? }`, `Person.telegramUsername?`, `Person.relationships: PersonRelationshipRef[]`, `normalizeChannel(raw: string): string` (exported from `lib/asset-groups/links.ts`)

- [ ] **Step 1: Update `lib/persons/types.ts`**

Replace the entire file with:

```ts
export interface PersonAddress {
  id: string;
  personId: string;
  address: string;
  label?: string;
  addedAt: number;
}

export type PersonRelationshipType = "friend" | "colleague" | "invited_by";

/** One relationship edge, from the perspective of the person it's attached
 *  to. `personId` is the OTHER person in the relationship. `direction` is
 *  only meaningful for "invited_by": "inviter" means this person invited
 *  the other; "invitee" means this person was invited by the other. */
export interface PersonRelationshipRef {
  id: string;
  personId: string;
  type: PersonRelationshipType;
  direction?: "inviter" | "invitee";
}

export interface Person {
  id: string;
  name: string;
  role?: string;
  notes?: string;
  telegramUsername?: string;
  addresses: PersonAddress[];
  relationships: PersonRelationshipRef[];
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Add `normalizeChannel` to `lib/asset-groups/links.ts`**

Add this function to the file (keep the existing `normalizeExternalUrl` and `resolveTelegramUrl` untouched):

```ts
/** Normalizes a Telegram channel name for dedup/matching: lowercase, strip a leading @ or /. */
export function normalizeChannel(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[@/]+/, "");
}
```

- [ ] **Step 3: Point `TelegramChannelClusters.tsx` at the shared helper**

In `components/persons/TelegramChannelClusters.tsx`, remove the locally-defined function:

```ts
function normalizeChannel(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[@/]+/, "");
}
```

and add an import instead:

```ts
import { normalizeChannel } from "@/lib/asset-groups/links";
```

(Place it alongside the existing imports at the top of the file — the rest of the component is unchanged, it already calls `normalizeChannel(...)`.)

- [ ] **Step 4: Add tests for `normalizeChannel`**

Append to `tests/lib/asset-group-links.test.ts`:

```ts
import { normalizeChannel } from "@/lib/asset-groups/links";

describe("normalizeChannel", () => {
  it("lowercases the channel name", () => {
    expect(normalizeChannel("MyChannel")).toBe("mychannel");
  });

  it("strips a leading @", () => {
    expect(normalizeChannel("@mychannel")).toBe("mychannel");
  });

  it("strips a leading /", () => {
    expect(normalizeChannel("/mychannel")).toBe("mychannel");
  });

  it("trims whitespace", () => {
    expect(normalizeChannel("  mychannel  ")).toBe("mychannel");
  });
});
```

(Add this as a new `import` line at the top of the file next to the existing `import { normalizeExternalUrl, resolveTelegramUrl } from "@/lib/asset-groups/links";` — combine into one import statement instead of two if you prefer, either compiles fine.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/lib/asset-group-links.test.ts`
Expected: all tests PASS (existing + 4 new `normalizeChannel` tests)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (note: `Person.relationships` is now required but nothing constructs a `Person` object literal yet outside `hooks/use-persons.ts` and `app/api/db/persons/route.ts` — both are fixed in later tasks. If tsc errors on either of those two files at this step, that's expected and will be resolved by Task 6/7; do not fix them here.)

- [ ] **Step 7: Commit**

```bash
git add lib/persons/types.ts lib/asset-groups/links.ts components/persons/TelegramChannelClusters.tsx tests/lib/asset-group-links.test.ts
git commit -m "feat(persons): add relationship + telegram types, extract normalizeChannel"
```

---

### Task 2: `groupsForAddress` helper

**Files:**
- Create: `lib/persons/address-groups.ts`
- Test: `tests/lib/persons/address-groups.test.ts`

**Interfaces:**
- Consumes: `AssetGroup` type from `lib/asset-groups/types.ts` (`{ id, name, members: GroupMember[], ... }`, `GroupMember { address, role, ... }`)
- Produces: `groupsForAddress(address: string, groups: AssetGroup[]): AssetGroup[]`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/persons/address-groups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupsForAddress } from "@/lib/persons/address-groups";
import type { AssetGroup, GroupMember } from "@/lib/asset-groups/types";

const ADDR_A = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";
const ADDR_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function makeMember(address: string, role: GroupMember["role"] = "other"): GroupMember {
  return { id: `m-${address}`, groupId: "g", address, role, addedAt: 1000 };
}

function makeGroup(id: string, members: GroupMember[]): AssetGroup {
  return { id, name: `Group ${id}`, network: "public", members, createdAt: 1000, updatedAt: 1000 };
}

describe("groupsForAddress", () => {
  it("returns an empty array when there are no groups", () => {
    expect(groupsForAddress(ADDR_A, [])).toEqual([]);
  });

  it("returns an empty array when the address is in no group", () => {
    const groups = [makeGroup("g1", [makeMember(ADDR_B)])];
    expect(groupsForAddress(ADDR_A, groups)).toEqual([]);
  });

  it("returns the group when the address is a member, regardless of role", () => {
    const groups = [makeGroup("g1", [makeMember(ADDR_A, "bank")])];
    expect(groupsForAddress(ADDR_A, groups)).toEqual(groups);
  });

  it("returns every group the address belongs to", () => {
    const g1 = makeGroup("g1", [makeMember(ADDR_A, "issuer")]);
    const g2 = makeGroup("g2", [makeMember(ADDR_B)]);
    const g3 = makeGroup("g3", [makeMember(ADDR_A, "distributor")]);
    expect(groupsForAddress(ADDR_A, [g1, g2, g3])).toEqual([g1, g3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/persons/address-groups.test.ts`
Expected: FAIL — `Cannot find module '@/lib/persons/address-groups'`

- [ ] **Step 3: Write the implementation**

Create `lib/persons/address-groups.ts`:

```ts
import type { AssetGroup } from "@/lib/asset-groups/types";

/** Every asset group where `address` appears as a member, under any role. */
export function groupsForAddress(address: string, groups: AssetGroup[]): AssetGroup[] {
  return groups.filter((g) => g.members.some((m) => m.address === address));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/persons/address-groups.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/persons/address-groups.ts tests/lib/persons/address-groups.test.ts
git commit -m "feat(persons): add groupsForAddress helper"
```

---

### Task 3: `telegramChannelsForPerson` helper

**Files:**
- Create: `lib/persons/telegram-channels.ts`
- Test: `tests/lib/persons/telegram-channels.test.ts`

**Interfaces:**
- Consumes: `groupsForAddress` (Task 2), `normalizeChannel` (Task 1), `Person` type (Task 1)
- Produces: `PersonTelegramChannel { key: string; raw: string; link?: string }`, `telegramChannelsForPerson(person: Person, groups: AssetGroup[]): PersonTelegramChannel[]`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/persons/telegram-channels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { telegramChannelsForPerson } from "@/lib/persons/telegram-channels";
import type { AssetGroup, GroupMember } from "@/lib/asset-groups/types";
import type { Person } from "@/lib/persons/types";

const ADDR_A = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";

function makeMember(address: string): GroupMember {
  return { id: `m-${address}`, groupId: "g", address, role: "other", addedAt: 1000 };
}

function makeGroup(id: string, opts: Partial<AssetGroup> = {}): AssetGroup {
  return { id, name: `Group ${id}`, network: "public", members: [], createdAt: 1000, updatedAt: 1000, ...opts };
}

function makePerson(opts: Partial<Person> = {}): Person {
  return {
    id: "p1",
    name: "Alice",
    addresses: [],
    relationships: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...opts,
  };
}

describe("telegramChannelsForPerson", () => {
  it("returns an empty array when the person has no related groups", () => {
    expect(telegramChannelsForPerson(makePerson(), [])).toEqual([]);
  });

  it("includes the channel of a group attributed to the person", () => {
    const person = makePerson();
    const groups = [makeGroup("g1", { personId: "p1", telegramChannel: "MyChannel" })];
    expect(telegramChannelsForPerson(person, groups)).toEqual([{ key: "mychannel", raw: "MyChannel" }]);
  });

  it("includes the channel of a group one of the person's addresses belongs to", () => {
    const person = makePerson({ addresses: [{ id: "a1", personId: "p1", address: ADDR_A, addedAt: 1000 }] });
    const groups = [makeGroup("g1", { members: [makeMember(ADDR_A)], telegramChannel: "BankChan" })];
    expect(telegramChannelsForPerson(person, groups)).toEqual([{ key: "bankchan", raw: "BankChan" }]);
  });

  it("dedupes the same channel across both sources, keeping the first-seen raw casing", () => {
    const person = makePerson({ addresses: [{ id: "a1", personId: "p1", address: ADDR_A, addedAt: 1000 }] });
    const groups = [
      makeGroup("g1", { personId: "p1", telegramChannel: "@Chan" }),
      makeGroup("g2", { members: [makeMember(ADDR_A)], telegramChannel: "chan" }),
    ];
    expect(telegramChannelsForPerson(person, groups)).toEqual([{ key: "chan", raw: "@Chan" }]);
  });

  it("skips groups with no telegramChannel set", () => {
    const person = makePerson();
    const groups = [makeGroup("g1", { personId: "p1" })];
    expect(telegramChannelsForPerson(person, groups)).toEqual([]);
  });

  it("carries the group's explicit telegramLink alongside the derived channel", () => {
    const person = makePerson();
    const groups = [
      makeGroup("g1", { personId: "p1", telegramChannel: "chan", telegramLink: "https://t.me/joinchat/xyz" }),
    ];
    expect(telegramChannelsForPerson(person, groups)).toEqual([
      { key: "chan", raw: "chan", link: "https://t.me/joinchat/xyz" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/persons/telegram-channels.test.ts`
Expected: FAIL — `Cannot find module '@/lib/persons/telegram-channels'`

- [ ] **Step 3: Write the implementation**

Create `lib/persons/telegram-channels.ts`:

```ts
import type { AssetGroup } from "@/lib/asset-groups/types";
import type { Person } from "@/lib/persons/types";
import { normalizeChannel } from "@/lib/asset-groups/links";
import { groupsForAddress } from "@/lib/persons/address-groups";

export interface PersonTelegramChannel {
  key: string;
  raw: string;
  link?: string;
}

/** Every distinct Telegram channel connected to this person: channels on
 *  groups they're attributed to, plus channels on groups any of their
 *  linked addresses belong to. Deduped by normalized channel name. Carries
 *  the originating group's explicit telegramLink (if set) so callers can
 *  defer to resolveTelegramUrl's "explicit link wins" contract instead of
 *  always deriving a t.me URL from the channel name. */
export function telegramChannelsForPerson(person: Person, groups: AssetGroup[]): PersonTelegramChannel[] {
  const seen = new Map<string, { raw: string; link?: string }>();

  const attributedGroups = groups.filter((g) => g.personId === person.id);
  const addressGroups = person.addresses.flatMap((a) => groupsForAddress(a.address, groups));

  for (const g of [...attributedGroups, ...addressGroups]) {
    if (!g.telegramChannel) continue;
    const key = normalizeChannel(g.telegramChannel);
    if (!key || seen.has(key)) continue;
    seen.set(key, { raw: g.telegramChannel, link: g.telegramLink });
  }

  return [...seen.entries()].map(([key, v]) => ({ key, raw: v.raw, link: v.link }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/persons/telegram-channels.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/persons/telegram-channels.ts tests/lib/persons/telegram-channels.test.ts
git commit -m "feat(persons): add telegramChannelsForPerson helper"
```

---

### Task 4: `computeClusters` helper

**Files:**
- Create: `lib/persons/relationship-clusters.ts`
- Test: `tests/lib/persons/relationship-clusters.test.ts`

**Interfaces:**
- Consumes: `Person`, `PersonRelationshipRef` (Task 1)
- Produces: `PersonCluster { personIds: string[]; edgeCount: number }`, `computeClusters(persons: Person[]): PersonCluster[]`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/persons/relationship-clusters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeClusters } from "@/lib/persons/relationship-clusters";
import type { Person } from "@/lib/persons/types";

function makePerson(id: string, name: string, relationships: Person["relationships"] = []): Person {
  return { id, name, addresses: [], relationships, createdAt: 1000, updatedAt: 1000 };
}

describe("computeClusters", () => {
  it("returns no clusters when no one has relationships", () => {
    const persons = [makePerson("p1", "Alice"), makePerson("p2", "Bob")];
    expect(computeClusters(persons)).toEqual([]);
  });

  it("groups two directly-related persons into one cluster", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].personIds.sort()).toEqual(["p1", "p2"]);
    expect(clusters[0].edgeCount).toBe(1);
  });

  it("transitively clusters A-B-C into one cluster even with no direct A-C edge", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [
        { id: "r1", personId: "p1", type: "friend" },
        { id: "r2", personId: "p3", type: "colleague" },
      ]),
      makePerson("p3", "Carol", [{ id: "r2", personId: "p2", type: "colleague" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].personIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(clusters[0].edgeCount).toBe(2);
  });

  it("keeps unrelated pairs as separate clusters", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
      makePerson("p3", "Carol", [{ id: "r2", personId: "p4", type: "invited_by", direction: "invitee" }]),
      makePerson("p4", "Dave", [{ id: "r2", personId: "p3", type: "invited_by", direction: "inviter" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(2);
  });

  it("omits persons with no relationships entirely", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
      makePerson("p3", "Carol"),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].personIds).not.toContain("p3");
  });

  it("sorts larger clusters first", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
      makePerson("p3", "Carol", [
        { id: "r2", personId: "p4", type: "colleague" },
        { id: "r3", personId: "p5", type: "colleague" },
      ]),
      makePerson("p4", "Dave", [{ id: "r2", personId: "p3", type: "colleague" }]),
      makePerson("p5", "Eve", [{ id: "r3", personId: "p3", type: "colleague" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].personIds).toHaveLength(3);
    expect(clusters[1].personIds).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/persons/relationship-clusters.test.ts`
Expected: FAIL — `Cannot find module '@/lib/persons/relationship-clusters'`

- [ ] **Step 3: Write the implementation**

Create `lib/persons/relationship-clusters.ts`:

```ts
import type { Person } from "@/lib/persons/types";

export interface PersonCluster {
  personIds: string[];
  edgeCount: number;
}

/** Connected components over all persons' relationship edges (union-find).
 *  Clusters of size 1 (no relationships) are omitted. Each underlying DB
 *  edge produces a ref on both sides sharing the same `id` — edges are
 *  counted once per cluster by deduping on that id. */
export function computeClusters(persons: Person[]): PersonCluster[] {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const p of persons) {
    find(p.id);
    for (const r of p.relationships) union(p.id, r.personId);
  }

  const membersByRoot = new Map<string, Set<string>>();
  for (const p of persons) {
    const root = find(p.id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, new Set());
    membersByRoot.get(root)!.add(p.id);
  }

  const countedEdgeIds = new Set<string>();
  const edgeCountByRoot = new Map<string, number>();
  for (const p of persons) {
    for (const r of p.relationships) {
      if (countedEdgeIds.has(r.id)) continue;
      countedEdgeIds.add(r.id);
      const root = find(p.id);
      edgeCountByRoot.set(root, (edgeCountByRoot.get(root) ?? 0) + 1);
    }
  }

  return [...membersByRoot.entries()]
    .filter(([, members]) => members.size > 1)
    .map(([root, members]) => ({ personIds: [...members], edgeCount: edgeCountByRoot.get(root) ?? 0 }))
    .sort((a, b) => b.personIds.length - a.personIds.length || b.edgeCount - a.edgeCount);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/persons/relationship-clusters.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/persons/relationship-clusters.ts tests/lib/persons/relationship-clusters.test.ts
git commit -m "feat(persons): add computeClusters helper"
```

---

### Task 5: Database migration — `person_relationships` table + `persons.telegram_username`

**Files:**
- Modify: `lib/db.ts`
- Modify: `supabase-schema.sql`

**Interfaces:**
- Produces: SQLite table `person_relationships(id, person_a_id, person_b_id, type, created_at)` with `ON DELETE CASCADE` on both FKs; SQLite column `persons.telegram_username`; same in Postgres via `supabase-schema.sql`.

- [ ] **Step 1: Add `person_relationships` table + `telegram_username` column to the SQLite DDL block**

In `lib/db.ts`, find this block (around line 146-167):

```ts
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

Replace it with:

```ts
    -- ── Persons (important-person registry — CEO, founder, etc) ────────────────

    CREATE TABLE IF NOT EXISTS persons (
      id                 TEXT    PRIMARY KEY,
      name               TEXT    NOT NULL,
      role               TEXT,
      notes              TEXT,
      telegram_username  TEXT,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS person_relationships (
      id            TEXT    PRIMARY KEY,
      person_a_id   TEXT    NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      person_b_id   TEXT    NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      type          TEXT    NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_person_relationships_a ON person_relationships(person_a_id);
    CREATE INDEX IF NOT EXISTS idx_person_relationships_b ON person_relationships(person_b_id);
```

- [ ] **Step 2: Add the `telegram_username` migration for already-provisioned local DBs**

The `CREATE TABLE IF NOT EXISTS` above only affects brand-new SQLite files — existing `stellar-toolkit.db` files need an explicit `ALTER TABLE`. In `lib/db.ts`, find the asset-groups migration block (around line 550-556):

```ts
  // ── Asset groups migration: add domain/telegram columns if missing ────────
  const assetGroupCols = (db.pragma("table_info(asset_groups)") as { name: string }[]).map((c) => c.name);
  if (!assetGroupCols.includes("domain")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN domain TEXT`);
  }
```

Add this new block immediately before it:

```ts
  // ── Persons migration: add telegram_username column if missing ────────────
  const personCols = (db.pragma("table_info(persons)") as { name: string }[]).map((c) => c.name);
  if (!personCols.includes("telegram_username")) {
    db.exec(`ALTER TABLE persons ADD COLUMN telegram_username TEXT`);
  }

  // ── Asset groups migration: add domain/telegram columns if missing ────────
  const assetGroupCols = (db.pragma("table_info(asset_groups)") as { name: string }[]).map((c) => c.name);
  if (!assetGroupCols.includes("domain")) {
    db.exec(`ALTER TABLE asset_groups ADD COLUMN domain TEXT`);
  }
```

- [ ] **Step 3: Mirror in `supabase-schema.sql`**

Add `telegram_username TEXT` to both existing `persons` table literals. Find (there are two identical occurrences, at the top of the file and in the "Persons module migration" section):

```sql
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
```

Replace **both** occurrences with:

```sql
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, role TEXT, notes TEXT, telegram_username TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
```

- [ ] **Step 4: Add the Postgres migration + new table**

Find this line near the end of `supabase-schema.sql`:

```sql
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES persons(id) ON DELETE SET NULL;
```

Add these lines immediately after it:

```sql
ALTER TABLE persons ADD COLUMN IF NOT EXISTS telegram_username TEXT;
CREATE TABLE IF NOT EXISTS person_relationships (id TEXT PRIMARY KEY, person_a_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, person_b_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE, type TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_person_relationships_a ON person_relationships(person_a_id);
CREATE INDEX IF NOT EXISTS idx_person_relationships_b ON person_relationships(person_b_id);
```

- [ ] **Step 5: Verify the SQLite migration runs cleanly**

The local `stellar-toolkit.db` already has a `persons` table without `telegram_username` — this step proves the migration path works before the API route (which depends on the new column/table) is built. Migrations run on the first `getDb()` call, which happens on any `/api/db/*` request — start the dev server briefly, hit one such route, stop it, then check the schema directly:

```bash
npm run dev &
sleep 3
curl -s -o /dev/null http://localhost:3000/persons
kill %1
sqlite3 stellar-toolkit.db "PRAGMA table_info(persons);" | grep telegram_username
sqlite3 stellar-toolkit.db "PRAGMA table_info(person_relationships);"
```

Expected: `telegram_username` appears in the `persons` columns; `person_relationships` shows all 5 columns (`id`, `person_a_id`, `person_b_id`, `type`, `created_at`).

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts supabase-schema.sql
git commit -m "feat(persons): add person_relationships table + telegram_username column"
```

---

### Task 6: API route — `telegramUsername` + `relationship` CRUD

**Files:**
- Modify: `app/api/db/persons/route.ts`

**Interfaces:**
- Consumes: `PersonRelationshipRef`, `PersonRelationshipType` (Task 1), `person_relationships` table (Task 5)
- Produces: `GET /api/db/persons` now returns each `Person` with `telegramUsername` and `relationships: PersonRelationshipRef[]`; `POST` accepts `{ type: "relationship", id, personAId, personBId, relationshipType }`; `DELETE` accepts `{ type: "relationship", key: id }`; `POST`/`PATCH` `{ type: "person", ... }` now also accept `telegramUsername`.

- [ ] **Step 1: Replace the top of the file (imports through `buildPersonsFromRows`)**

Replace lines 1-39 of `app/api/db/persons/route.ts` (from the imports down through the end of `buildPersonsFromRows`) with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";
import type { Person, PersonAddress, PersonRelationshipRef, PersonRelationshipType } from "@/lib/persons/types";

type PersonRow = Record<string, unknown>;
type AddressRow = Record<string, unknown>;
type RelationshipRow = Record<string, unknown>;

function rowToAddress(r: AddressRow): PersonAddress {
  return {
    id: r.id as string,
    personId: r.person_id as string,
    address: r.address as string,
    label: (r.label as string) ?? undefined,
    addedAt: r.added_at as number,
  };
}

/** Each relationship row produces two refs — one attached to each side. For
 *  "invited_by", person_a_id is the inviter. */
function relationshipRefsFromRow(
  r: RelationshipRow,
): { aId: string; bId: string; forA: PersonRelationshipRef; forB: PersonRelationshipRef } {
  const type = r.type as PersonRelationshipType;
  const isInvite = type === "invited_by";
  return {
    aId: r.person_a_id as string,
    bId: r.person_b_id as string,
    forA: { id: r.id as string, personId: r.person_b_id as string, type, direction: isInvite ? "inviter" : undefined },
    forB: { id: r.id as string, personId: r.person_a_id as string, type, direction: isInvite ? "invitee" : undefined },
  };
}

function buildRelationshipsByPerson(rows: RelationshipRow[]): Map<string, PersonRelationshipRef[]> {
  const map = new Map<string, PersonRelationshipRef[]>();
  for (const row of rows) {
    const { aId, bId, forA, forB } = relationshipRefsFromRow(row);
    if (!map.has(aId)) map.set(aId, []);
    map.get(aId)!.push(forA);
    if (!map.has(bId)) map.set(bId, []);
    map.get(bId)!.push(forB);
  }
  return map;
}

function rowToPerson(r: PersonRow, addresses: PersonAddress[], relationships: PersonRelationshipRef[]): Person {
  return {
    id: r.id as string,
    name: r.name as string,
    role: (r.role as string) ?? undefined,
    notes: (r.notes as string) ?? undefined,
    telegramUsername: (r.telegram_username as string) ?? undefined,
    addresses,
    relationships,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function buildPersonsFromRows(
  persons: PersonRow[],
  allAddresses: AddressRow[],
  allRelationships: RelationshipRow[],
): Person[] {
  const addressesByPerson = new Map<string, PersonAddress[]>();
  for (const a of allAddresses) {
    const pid = a.person_id as string;
    if (!addressesByPerson.has(pid)) addressesByPerson.set(pid, []);
    addressesByPerson.get(pid)!.push(rowToAddress(a));
  }
  const relationshipsByPerson = buildRelationshipsByPerson(allRelationships);
  return persons.map((p) =>
    rowToPerson(
      p,
      addressesByPerson.get(p.id as string) ?? [],
      relationshipsByPerson.get(p.id as string) ?? [],
    ),
  );
}
```

- [ ] **Step 2: Update `GET` to fetch and pass relationships**

Replace the `GET` function with:

```ts
/** GET /api/db/persons — all persons with their addresses and relationships */
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
    // person_a_id ∈ personIds already implies person_b_id ∈ personIds too —
    // both sides of a relationship are always created under the same caller.
    const { data: allRelationships, error: relationshipsError } = personIds.length > 0
      ? await sb.from("person_relationships").select("*").in("person_a_id", personIds)
      : { data: [], error: null };
    if (relationshipsError) {
      console.error("[persons] GET (relationships) failed:", relationshipsError);
      return NextResponse.json({ error: relationshipsError.message }, { status: 500 });
    }
    return NextResponse.json(buildPersonsFromRows(persons ?? [], allAddresses ?? [], allRelationships ?? []));
  }

  const db = getDb();
  const persons = db
    .prepare("SELECT * FROM persons ORDER BY updated_at DESC")
    .all() as PersonRow[];
  const allAddresses = db
    .prepare("SELECT * FROM person_addresses ORDER BY added_at ASC")
    .all() as AddressRow[];
  const allRelationships = db
    .prepare("SELECT * FROM person_relationships")
    .all() as RelationshipRow[];
  return NextResponse.json(buildPersonsFromRows(persons, allAddresses, allRelationships));
}
```

- [ ] **Step 3: Update the `POST` "person" branch to accept `telegramUsername`**

Replace the `if (body.type === "person") { ... }` block inside `POST` with:

```ts
  if (body.type === "person") {
    const { id, name, role, notes, telegramUsername } = body;
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
        telegram_username: telegramUsername ?? null,
        created_at: now,
        updated_at: now,
      });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    getDb()
      .prepare(
        `INSERT INTO persons (id, name, role, notes, telegram_username, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name              = excluded.name,
           role              = excluded.role,
           notes             = excluded.notes,
           telegram_username = excluded.telegram_username,
           updated_at        = excluded.updated_at`,
      )
      .run(id, nameTrimmed, role ?? null, notes ?? null, telegramUsername ?? null, now, now);

    syncToSupabase(async () => {
      await getSupabase()!.from("persons").upsert({
        id,
        user_id: userId,
        name: nameTrimmed,
        role: role ?? null,
        notes: notes ?? null,
        telegram_username: telegramUsername ?? null,
        created_at: now,
        updated_at: now,
      });
    });

    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 4: Add a `POST` "relationship" branch**

Immediately after the `if (body.type === "address") { ... }` block (and before the final `return NextResponse.json({ error: "unknown type" }, { status: 400 });` that ends `POST`), add:

```ts
  if (body.type === "relationship") {
    const { id, personAId, personBId, relationshipType } = body;

    if (isSupabaseOnly()) {
      const sb = getSupabase()!;
      // IDOR guard: both ends of the relationship must belong to the caller.
      const { data: owned } = await sb
        .from("persons")
        .select("id")
        .in("id", [personAId, personBId])
        .eq("user_id", userId!);
      if (!owned || owned.length !== 2) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      const { error } = await sb.from("person_relationships").insert({
        id,
        person_a_id: personAId,
        person_b_id: personBId,
        type: relationshipType,
        created_at: now,
      });
      if (error) {
        if (error.code === "23503") return NextResponse.json({ ok: false, error: "person_not_found" }, { status: 409 });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO person_relationships (id, person_a_id, person_b_id, type, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, personAId, personBId, relationshipType, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("foreign key")) {
        return NextResponse.json({ ok: false, error: "person_not_found" }, { status: 409 });
      }
      throw error;
    }

    syncToSupabase(async () => {
      await getSupabase()!.from("person_relationships").insert({
        id,
        person_a_id: personAId,
        person_b_id: personBId,
        type: relationshipType,
        created_at: now,
      });
    });

    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 5: Update `PATCH` to accept `telegramUsername`**

Replace the body of `PATCH` from `const { id, name, role, notes } = body;` through its final `return NextResponse.json({ ok: true });` with:

```ts
  const { id, name, role, notes, telegramUsername } = body;

  if (isSupabaseOnly()) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (notes !== undefined) patch.notes = notes;
    if (telegramUsername !== undefined) patch.telegram_username = telegramUsername;
    const { error } = await getSupabase()!.from("persons").update(patch).eq("id", id).eq("user_id", userId!);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `UPDATE persons SET
         name              = COALESCE(?, name),
         role              = COALESCE(?, role),
         notes             = COALESCE(?, notes),
         telegram_username = COALESCE(?, telegram_username),
         updated_at        = ?
       WHERE id = ?`,
    )
    .run(name ?? null, role ?? null, notes ?? null, telegramUsername ?? null, now, id);

  syncToSupabase(async () => {
    const patch: Record<string, unknown> = { updated_at: now };
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (notes !== undefined) patch.notes = notes;
    if (telegramUsername !== undefined) patch.telegram_username = telegramUsername;
    await getSupabase()!.from("persons").update(patch).eq("id", id).eq("user_id", userId!);
  });

  return NextResponse.json({ ok: true });
```

(This preserves the existing `COALESCE` behavior — a field is only updated when explicitly passed, same as `name`/`role`/`notes` today.)

- [ ] **Step 6: Add relationship handling to `DELETE`**

Replace the entire `DELETE` function with:

```ts
/** DELETE /api/db/persons — delete person, address, or relationship */
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
    } else if (type === "relationship") {
      // person_relationships has no user_id — scope via person_a_id's owner
      const { data: rel } = await sb.from("person_relationships").select("person_a_id").eq("id", key).single();
      if (rel) {
        const { data: parentPerson } = await sb.from("persons").select("id").eq("id", rel.person_a_id).eq("user_id", userId!).single();
        if (parentPerson) {
          const { error } = await sb.from("person_relationships").delete().eq("id", key);
          if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
      }
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
  } else if (type === "relationship") {
    db.prepare("DELETE FROM person_relationships WHERE id = ?").run(key);
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    if (type === "person") {
      return sb.from("persons").delete().eq("id", key).eq("user_id", userId!);
    } else if (type === "relationship") {
      const { data: rel } = await sb.from("person_relationships").select("person_a_id").eq("id", key).single();
      if (!rel) return;
      const { data: parentPerson } = await sb.from("persons").select("id").eq("id", rel.person_a_id).eq("user_id", userId!).single();
      if (!parentPerson) return;
      return sb.from("person_relationships").delete().eq("id", key);
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

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/api/db/persons/route.ts`

- [ ] **Step 8: Commit**

```bash
git add app/api/db/persons/route.ts
git commit -m "feat(persons): serve telegramUsername + relationships from API route"
```

---

### Task 7: `hooks/use-persons.ts` — relationship mutations

**Files:**
- Modify: `hooks/use-persons.ts`

**Interfaces:**
- Consumes: `PersonRelationshipType` (Task 1), the `POST`/`DELETE` `"relationship"` handling (Task 6)
- Produces: `usePersons()` now also returns `createRelationship(personAId: string, personBId: string, type: PersonRelationshipType): void` and `deleteRelationship(id: string): void`; `updatePerson` now accepts `telegramUsername` in its patch.

- [ ] **Step 1: Replace the whole file**

Replace `hooks/use-persons.ts` in full with:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, authHeaders, debounce } from "@/lib/db-client";
import type { Person, PersonAddress, PersonRelationshipType } from "@/lib/persons/types";

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
function dbDeleteRelationship(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "relationship" }),
  }).catch(() => {});
}
const _cache = createDbCache<Person>();

// asset_groups.person_id is a foreign key — a PATCH linking a group to a
// still-in-flight new person can commit before the person's own INSERT does,
// tripping the FK constraint. Callers that immediately link a freshly created
// person (e.g. GroupsPanel's "+ New Person" flow) must await this first.
const _pendingPersonCreates = new Map<string, Promise<void>>();

export function getPersonsSnapshot(): Person[] {
  return _cache.get();
}

export function isPersonsLoaded(): boolean {
  return _cache.isLoaded();
}

/** Resolves once a person created via createPerson has been persisted server-side. */
export function waitForPersonId(id: string): Promise<string> {
  return (_pendingPersonCreates.get(id) ?? Promise.resolve()).then(() => id);
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
      relationships: [],
      createdAt: now,
      updatedAt: now,
    };
    _cache.set([newPerson, ..._cache.get()]);
    const p = dbPost(ENDPOINT, { type: "person", id, name: nameTrimmed, role: entry.role, notes: entry.notes })
      .then(() => undefined)
      .catch((err) => {
        _cache.reload(ENDPOINT);
        throw err;
      });
    _pendingPersonCreates.set(id, p);
    return id;
  }, []);

  const updatePerson = useCallback(
    (id: string, patch: Partial<Pick<Person, "name" | "role" | "notes" | "telegramUsername">>) => {
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

  const createRelationship = useCallback(
    (personAId: string, personBId: string, relType: PersonRelationshipType) => {
      const id = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const isInvite = relType === "invited_by";
      _cache.set(
        _cache.get().map((p) => {
          if (p.id === personAId) {
            return {
              ...p,
              relationships: [
                ...p.relationships,
                { id, personId: personBId, type: relType, direction: isInvite ? ("inviter" as const) : undefined },
              ],
              updatedAt: now,
            };
          }
          if (p.id === personBId) {
            return {
              ...p,
              relationships: [
                ...p.relationships,
                { id, personId: personAId, type: relType, direction: isInvite ? ("invitee" as const) : undefined },
              ],
              updatedAt: now,
            };
          }
          return p;
        }),
      );
      dbPost(ENDPOINT, { type: "relationship", id, personAId, personBId, relationshipType: relType }).catch(() =>
        _cache.reload(ENDPOINT),
      );
    },
    [],
  );

  const deleteRelationship = useCallback((id: string) => {
    _cache.set(
      _cache.get().map((p) => ({
        ...p,
        relationships: p.relationships.filter((r) => r.id !== id),
      })),
    );
    dbDeleteRelationship(id);
  }, []);

  return {
    persons,
    isLoaded: _cache.isLoaded(),
    createPerson,
    updatePerson,
    deletePerson,
    addPersonAddress,
    removePersonAddress,
    createRelationship,
    deleteRelationship,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add hooks/use-persons.ts
git commit -m "feat(persons): add createRelationship/deleteRelationship to usePersons"
```

---

### Task 8: Extract `PersonCard` into its own file (pure refactor, no behavior change)

**Files:**
- Create: `components/persons/PersonCard.tsx`
- Modify: `components/persons/PersonsPanel.tsx`

**Interfaces:**
- Produces: `PersonCard` as a named export from its own file, imported by `PersonsPanel.tsx`. No prop or behavior changes — this step must be a no-op visually.

- [ ] **Step 1: Create `components/persons/PersonCard.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2, Pencil, Check, X, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePersons } from "@/hooks/use-persons";
import { useConfirmClick } from "@/hooks/use-confirm-click";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import type { Person } from "@/lib/persons/types";

export function PersonCard({ person }: { person: Person }) {
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
  const { confirming: confirmingDelete, onClick: handleDeleteClick } = useConfirmClick(() => deletePerson(person.id));

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
            size={confirmingDelete ? "sm" : "icon"}
            variant="ghost"
            className={
              confirmingDelete
                ? "h-8 px-2 text-xs font-semibold whitespace-nowrap bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive"
                : "h-7 w-7 text-destructive hover:text-destructive"
            }
            title={
              confirmingDelete
                ? "Click again to confirm delete"
                : `Delete — unlinks from ${attributedGroups.length} asset group(s), removes ${person.addresses.length} linked address(es)`
            }
            onClick={handleDeleteClick}
          >
            {confirmingDelete ? "Confirm delete" : <Trash2 className="h-3.5 w-3.5" />}
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
```

- [ ] **Step 2: Update `components/persons/PersonsPanel.tsx`**

Replace the whole file with:

```tsx
"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePersons } from "@/hooks/use-persons";
import { PersonCard } from "@/components/persons/PersonCard";
import { TelegramChannelClusters } from "@/components/persons/TelegramChannelClusters";

export function PersonsPanel() {
  const { persons, isLoaded, createPerson } = usePersons();
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
      <TelegramChannelClusters />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/persons/PersonCard.tsx components/persons/PersonsPanel.tsx
git commit -m "refactor(persons): extract PersonCard into its own file"
```

---

### Task 9: `PersonCard` — Telegram username field + derived channel pills

**Files:**
- Modify: `components/persons/PersonCard.tsx`

**Interfaces:**
- Consumes: `telegramChannelsForPerson` (Task 3), `resolveTelegramUrl` (`lib/asset-groups/links.ts`, pre-existing)

- [ ] **Step 1: Add the import**

In `components/persons/PersonCard.tsx`, add to the imports:

```tsx
import { telegramChannelsForPerson } from "@/lib/persons/telegram-channels";
import { resolveTelegramUrl } from "@/lib/asset-groups/links";
```

- [ ] **Step 2: Add `telegramVal` state and include it in `save()`**

Change:

```tsx
  const [notesVal, setNotesVal] = useState(person.notes ?? "");
```

to:

```tsx
  const [notesVal, setNotesVal] = useState(person.notes ?? "");
  const [telegramVal, setTelegramVal] = useState(person.telegramUsername ?? "");
```

Change:

```tsx
  function save() {
    updatePerson(person.id, {
      name: nameVal.trim() || person.name,
      role: roleVal.trim() || undefined,
      notes: notesVal.trim() || undefined,
    });
    setEditing(false);
  }
```

to:

```tsx
  function save() {
    updatePerson(person.id, {
      name: nameVal.trim() || person.name,
      role: roleVal.trim() || undefined,
      notes: notesVal.trim() || undefined,
      telegramUsername: telegramVal.trim() || undefined,
    });
    setEditing(false);
  }
```

- [ ] **Step 3: Add the edit-mode input**

Change:

```tsx
                <Input value={notesVal} onChange={(e) => setNotesVal(e.target.value)} className="h-7 text-xs" placeholder="Notes" />
                <div className="flex gap-2">
```

to:

```tsx
                <Input value={notesVal} onChange={(e) => setNotesVal(e.target.value)} className="h-7 text-xs" placeholder="Notes" />
                <Input value={telegramVal} onChange={(e) => setTelegramVal(e.target.value)} className="h-7 text-xs" placeholder="Telegram username (e.g. @alice)" />
                <div className="flex gap-2">
```

- [ ] **Step 4: Show the Telegram username + derived channel pills in read mode**

Change:

```tsx
            {!editing && person.notes && <p className="text-xs text-muted-foreground mt-1">{person.notes}</p>}
          </div>
```

to:

```tsx
            {!editing && person.notes && <p className="text-xs text-muted-foreground mt-1">{person.notes}</p>}
            {!editing && person.telegramUsername && (
              <a
                href={resolveTelegramUrl(person.telegramUsername)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline mt-0.5 inline-block"
              >
                @{person.telegramUsername.replace(/^@/, "")}
              </a>
            )}
          </div>
```

- [ ] **Step 5: Add the related-channels pill section**

Add this block right before the final closing `</CardContent>` (i.e. right after the existing "Attributed to N asset group(s)" `<div className="space-y-1">...</div>` block):

```tsx
        {(() => {
          const channels = telegramChannelsForPerson(person, groups);
          if (channels.length === 0) return null;
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Related Telegram channels</Label>
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <a
                    key={c.key}
                    href={resolveTelegramUrl(c.raw, c.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-0.5 rounded-full bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition-colors"
                  >
                    @{c.key}
                  </a>
                ))}
              </div>
            </div>
          );
        })()}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add components/persons/PersonCard.tsx
git commit -m "feat(persons): add Telegram username field + related-channels pills"
```

---

### Task 10: `PersonCard` — per-address group-membership pills

**Files:**
- Modify: `components/persons/PersonCard.tsx`

**Interfaces:**
- Consumes: `groupsForAddress` (Task 2), `ROLE_LABELS`, `ROLE_COLORS` (`lib/asset-groups/types.ts`, pre-existing)

- [ ] **Step 1: Add the imports**

Add to the imports in `components/persons/PersonCard.tsx`:

```tsx
import { groupsForAddress } from "@/lib/persons/address-groups";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/asset-groups/types";
```

- [ ] **Step 2: Render group-membership pills under each address**

Change the address row:

```tsx
            {person.addresses.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <ShortAddress address={a.address} network={settings.network} />
                {a.label && <span className="text-muted-foreground">{a.label}</span>}
                <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => removePersonAddress(person.id, a.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
```

to:

```tsx
            {person.addresses.map((a) => {
              const addressGroups = groupsForAddress(a.address, groups);
              return (
                <div key={a.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <ShortAddress address={a.address} network={settings.network} />
                    {a.label && <span className="text-muted-foreground">{a.label}</span>}
                    <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => removePersonAddress(person.id, a.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  {addressGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-1">
                      {addressGroups.map((g) => {
                        const member = g.members.find((m) => m.address === a.address)!;
                        return (
                          <Link
                            key={g.id}
                            href={`/groups?open=${g.id}`}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full hover:opacity-80 transition-opacity ${ROLE_COLORS[member.role]}`}
                          >
                            {g.name} · {ROLE_LABELS[member.role]}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/persons/PersonCard.tsx
git commit -m "feat(persons): show per-address asset-group membership pills"
```

---

### Task 11: `PersonCard` — relationships UI

**Files:**
- Modify: `components/persons/PersonCard.tsx`

**Interfaces:**
- Consumes: `createRelationship`, `deleteRelationship` (Task 7), `PersonRelationshipType` (Task 1)

- [ ] **Step 1: Add imports and read the full persons list**

Add to the imports:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PersonRelationshipType } from "@/lib/persons/types";
```

Change:

```tsx
export function PersonCard({ person }: { person: Person }) {
  const { updatePerson, deletePerson, addPersonAddress, removePersonAddress } = usePersons();
```

to:

```tsx
const RELATIONSHIP_LABELS: Record<PersonRelationshipType, string> = {
  friend: "Friend",
  colleague: "Colleague",
  invited_by: "Invited by",
};

export function PersonCard({ person }: { person: Person }) {
  const { persons, updatePerson, deletePerson, addPersonAddress, removePersonAddress, createRelationship, deleteRelationship } = usePersons();
```

- [ ] **Step 2: Add relationship form state**

Change:

```tsx
  const [newAddressLabel, setNewAddressLabel] = useState("");
```

to:

```tsx
  const [newAddressLabel, setNewAddressLabel] = useState("");
  const [addingRelationship, setAddingRelationship] = useState(false);
  const [relationshipTargetId, setRelationshipTargetId] = useState("");
  const [relationshipType, setRelationshipType] = useState<PersonRelationshipType>("friend");
```

- [ ] **Step 3: Add a relationship-label helper**

Add this function right after `save()`:

```tsx
  function relationshipLabel(r: Person["relationships"][number]): string {
    const other = persons.find((p) => p.id === r.personId)?.name ?? "Unknown person";
    if (r.type === "invited_by") {
      return r.direction === "inviter" ? `Invited ${other}` : `Invited by ${other}`;
    }
    return `${RELATIONSHIP_LABELS[r.type]}: ${other}`;
  }
```

- [ ] **Step 4: Render the relationships section**

Add this block right after the "Related Telegram channels" block added in Task 9 (i.e. still before the final `</CardContent>`):

```tsx
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Relationships</Label>
          {person.relationships.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {person.relationships.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent"
                >
                  {relationshipLabel(r)}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-4 w-4 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteRelationship(r.id)}
                    aria-label="Remove relationship"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </span>
              ))}
            </div>
          )}
          {addingRelationship ? (
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={relationshipTargetId} onValueChange={setRelationshipTargetId}>
                <SelectTrigger className="h-7 text-xs w-40">
                  <SelectValue placeholder="Person" />
                </SelectTrigger>
                <SelectContent>
                  {persons.filter((p) => p.id !== person.id).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={relationshipType} onValueChange={(v) => setRelationshipType(v as PersonRelationshipType)}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="friend">Friend</SelectItem>
                  <SelectItem value="colleague">Colleague</SelectItem>
                  <SelectItem value="invited_by">Invited by</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (relationshipTargetId) {
                    // "Invited by" read from THIS card means the OTHER
                    // person did the inviting — so they are person_a
                    // (inviter) and this card's person is person_b
                    // (invitee). friend/colleague are symmetric, so the
                    // argument order doesn't matter for those.
                    if (relationshipType === "invited_by") {
                      createRelationship(relationshipTargetId, person.id, relationshipType);
                    } else {
                      createRelationship(person.id, relationshipTargetId, relationshipType);
                    }
                  }
                  setRelationshipTargetId("");
                  setRelationshipType("friend");
                  setAddingRelationship(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setAddingRelationship(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add relationship
            </Button>
          )}
        </div>
```

Note: picking "Invited by" + Bob on Alice's card means Bob invited Alice — so the call passes Bob as `personAId` (inviter) and Alice (`person.id`) as `personBId` (invitee). Alice's card then correctly shows "Invited by Bob" (via her `direction: "invitee"` ref) and Bob's card shows "Invited Alice" (via his `direction: "inviter"` ref) — matching the dropdown label read from the card it's opened on.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add components/persons/PersonCard.tsx
git commit -m "feat(persons): add relationships UI to PersonCard"
```

---

### Task 12: Relationship Clusters section

**Files:**
- Create: `components/persons/RelationshipClusters.tsx`
- Modify: `components/persons/PersonsPanel.tsx`

**Interfaces:**
- Consumes: `computeClusters` (Task 4)

- [ ] **Step 1: Create `components/persons/RelationshipClusters.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePersons } from "@/hooks/use-persons";
import { computeClusters } from "@/lib/persons/relationship-clusters";

export function RelationshipClusters() {
  const [show, setShow] = useState(false);
  const { persons } = usePersons();

  const clusters = useMemo(() => computeClusters(persons), [persons]);

  if (clusters.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Connected Persons</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Groups of persons linked by relationships (friend/colleague/invited-by), including transitive connections.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {show && (
        <CardContent className="pt-0">
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Members</th>
                  <th className="px-3 py-2 text-right font-medium">Relationships</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <tr key={c.personIds.slice().sort().join(",")} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      {c.personIds
                        .map((id) => persons.find((p) => p.id === id)?.name ?? "Unknown person")
                        .join(", ")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{c.edgeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into `PersonsPanel.tsx`**

Change:

```tsx
import { TelegramChannelClusters } from "@/components/persons/TelegramChannelClusters";
```

to:

```tsx
import { TelegramChannelClusters } from "@/components/persons/TelegramChannelClusters";
import { RelationshipClusters } from "@/components/persons/RelationshipClusters";
```

Change:

```tsx
      <TelegramChannelClusters />
    </div>
  );
}
```

to:

```tsx
      <TelegramChannelClusters />
      <RelationshipClusters />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/persons/RelationshipClusters.tsx components/persons/PersonsPanel.tsx
git commit -m "feat(persons): add Relationship Clusters section"
```

---

### Task 13: Full test suite + manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS, including the 4 new files added in Tasks 1-4 (`asset-group-links.test.ts` additions, `address-groups.test.ts`, `telegram-channels.test.ts`, `relationship-clusters.test.ts`)

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project

- [ ] **Step 3: Manual browser verification**

Start the dev server if not already running (`npm run dev`), then using the browser (Playwright MCP or manual):

1. Go to `/persons`. Create two persons, "Alice" and "Bob".
2. Open Alice's card, set her Telegram username to `alice_test`. Confirm it renders as a clickable `@alice_test` link under her name after saving.
3. Add an address to Alice that is already a member of an existing Asset Group (use any address already in `/groups` — check the Groups page first if none exist locally, or add Alice's address to a test group first). Confirm a small pill appears under that address showing the group name + role, separate from "Attributed to N asset group(s)".
4. On Alice's card, click "+ Add relationship", pick Bob, type "Friend", save. Confirm a pill "Friend: Bob" appears on Alice's card, and — after reloading the page — a pill "Friend: Alice" appears on Bob's card.
5. Scroll down, confirm the "Connected Persons" section appears (collapsed by default) and expanding it shows one cluster row with "Alice, Bob" and relationship count 1.
6. Delete the relationship from either card, confirm both pills disappear and the cluster section disappears entirely (0 clusters).
7. Check browser console for errors throughout — none expected beyond any pre-existing unrelated noise.

- [ ] **Step 4: Report**

No commit for this task — it's verification only. If any step fails, fix the underlying task and re-run this whole task from Step 1.
