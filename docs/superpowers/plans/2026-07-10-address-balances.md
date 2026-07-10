# Address Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New module — paste a list of Stellar addresses, see each one's total XLM balance and XLM available-to-withdraw (balance minus reserve minus selling liabilities).

**Architecture:** Standard module layout (`page.tsx` thin shell → `AddressBalancesPanel.tsx` client component). Two new pure-function lib files (`stellar-reserve.ts` for the reserve math, `address-balances/fetchers.ts` for the Horizon call). Persistence reuses `useBulkScanState`, extended with a `scan_key` param so this module and Bulk Asset Sales don't clobber each other's saved scan state.

**Tech Stack:** Next.js App Router, React, TypeScript, `stellar-sdk` (`StrKey` only, no SDK network calls — raw `fetch` against Horizon REST), Vitest for lib tests, `better-sqlite3` (local) / Supabase (deployed) via existing dual-mode DB layer.

## Global Constraints

- Never force-uppercase or otherwise mutate Stellar addresses.
- `AppLayout` already provides `container mx-auto p-4 md:p-8 max-w-7xl` — `page.tsx` must not add another max-width/padding wrapper.
- Never hand-roll a `fetch()` DB wrapper — use `dbPost`/`dbPatch`/`dbDelete` where applicable (not needed here; `useBulkScanState` already wraps its own fetches).
- Do not modify `app/(tools)/my-wallet/page.tsx` or `app/(tools)/payments/page.tsx` — those are working modules; the reserve-calc logic is extracted fresh into a new file instead of refactoring them.
- Do not modify anything in `components/asset-sales/BulkAssetSalesTab.tsx`'s behavior — its `useBulkScanState()` call (no key) must keep working identically after the `scan_key` change (implicit default).
- Use shared components only: `<Input>`, `<Button>`, `<Table>` family from `@/components/ui`; `<ShortAddress>` for any address display. No raw `<input>`/`<button>`/`<table>`.
- Network always from global `useSettings()` — no per-module network selector.

---

### Task 1: `lib/stellar-reserve.ts` — reserve/available XLM calculation

**Files:**
- Create: `lib/stellar-reserve.ts`
- Test: `tests/lib/stellar-reserve.test.ts`

**Interfaces:**
- Produces: `calcAvailableXlm(account: RawHorizonAccount): { total: number; reserved: number; available: number }` and the exported `RawHorizonAccount` interface — Task 2 imports both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/stellar-reserve.test.ts
import { describe, it, expect } from "vitest";
import { calcAvailableXlm, type RawHorizonAccount } from "@/lib/stellar-reserve";

function makeAccount(overrides: Partial<RawHorizonAccount> = {}): RawHorizonAccount {
  return {
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    balances: [{ asset_type: "native", balance: "100.0000000" }],
    ...overrides,
  };
}

describe("calcAvailableXlm", () => {
  it("base reserve only (no subentries)", () => {
    const result = calcAvailableXlm(makeAccount());
    expect(result.total).toBe(100);
    expect(result.reserved).toBe(1.0); // (2 + 0) * 0.5
    expect(result.available).toBeCloseTo(99, 7);
  });

  it("adds 0.5 XLM reserve per subentry (trustline/offer/signer)", () => {
    const result = calcAvailableXlm(makeAccount({ subentry_count: 3 }));
    expect(result.reserved).toBe(2.5); // (2 + 3) * 0.5
    expect(result.available).toBeCloseTo(97.5, 7);
  });

  it("sponsoring increases reserve, sponsored decreases it", () => {
    const result = calcAvailableXlm(
      makeAccount({ num_sponsoring: 2, num_sponsored: 1 }),
    );
    // reserved = (2+0)*0.5 + 2*0.5 - 1*0.5 = 1.0 + 1.0 - 0.5 = 1.5
    expect(result.reserved).toBe(1.5);
    expect(result.available).toBeCloseTo(98.5, 7);
  });

  it("subtracts native selling_liabilities from available", () => {
    const result = calcAvailableXlm(
      makeAccount({
        balances: [
          { asset_type: "native", balance: "100.0000000", selling_liabilities: "10.0000000" },
        ],
      }),
    );
    expect(result.total).toBe(100);
    expect(result.reserved).toBe(1.0);
    expect(result.available).toBeCloseTo(89, 7);
  });

  it("clamps available to 0 when reserve + liabilities exceed balance", () => {
    const result = calcAvailableXlm(
      makeAccount({
        subentry_count: 10,
        balances: [
          { asset_type: "native", balance: "1.0000000", selling_liabilities: "5.0000000" },
        ],
      }),
    );
    expect(result.available).toBe(0);
  });

  it("returns total 0 when no native balance entry exists", () => {
    const result = calcAvailableXlm(makeAccount({ balances: [] }));
    expect(result.total).toBe(0);
    expect(result.available).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/stellar-reserve.test.ts`
Expected: FAIL — `Cannot find module '@/lib/stellar-reserve'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/stellar-reserve.ts

const BASE_RESERVE = 0.5;

export interface RawHorizonAccount {
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: Array<{
    asset_type: string;
    balance: string;
    selling_liabilities?: string;
  }>;
}

export interface AvailableXlmResult {
  total: number;
  reserved: number;
  available: number;
}

/**
 * Reserve/available math per Stellar's base-reserve protocol rule:
 * every subentry (trustline, offer, signer, data entry) costs 0.5 XLM,
 * sponsored subentries are paid by the sponsor instead of this account.
 * Mirrors my-wallet's calcReserved formula (not payments' simplified copy,
 * which omits sponsoring/sponsored).
 */
export function calcAvailableXlm(account: RawHorizonAccount): AvailableXlmResult {
  const native = account.balances.find((b) => b.asset_type === "native");
  const total = native ? parseFloat(native.balance) : 0;
  const sellingLiabilities = native?.selling_liabilities
    ? parseFloat(native.selling_liabilities)
    : 0;

  const reserved =
    (2 + account.subentry_count) * BASE_RESERVE +
    account.num_sponsoring * BASE_RESERVE -
    account.num_sponsored * BASE_RESERVE;

  const available = Math.max(0, total - reserved - sellingLiabilities);

  return { total, reserved, available };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/stellar-reserve.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/stellar-reserve.ts tests/lib/stellar-reserve.test.ts
git commit -m "feat: add calcAvailableXlm reserve/available balance helper"
```

---

### Task 2: `lib/address-balances/fetchers.ts` — per-address Horizon fetch

**Files:**
- Create: `lib/address-balances/fetchers.ts`
- Test: `tests/lib/address-balances/fetchers.test.ts`

**Interfaces:**
- Consumes: `calcAvailableXlm`, `RawHorizonAccount` from `@/lib/stellar-reserve` (Task 1).
- Produces: `fetchAddressBalance(horizonUrl: string, address: string, signal?: AbortSignal): Promise<AddressBalanceResult>` and `AddressBalanceResult` type — Task 4 (panel) imports both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/address-balances/fetchers.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAddressBalance } from "@/lib/address-balances/fetchers";

const ADDR = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";

describe("fetchAddressBalance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok with total/available on success", async () => {
    (fetch as any).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        subentry_count: 0,
        num_sponsoring: 0,
        num_sponsored: 0,
        balances: [{ asset_type: "native", balance: "50.0000000" }],
      }),
    });

    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "ok", total: 50, available: 49 });
  });

  it("returns unfunded on 404", async () => {
    (fetch as any).mockResolvedValue({ status: 404, ok: false });
    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "unfunded" });
  });

  it("returns error on non-OK non-404 response", async () => {
    (fetch as any).mockResolvedValue({ status: 500, ok: false });
    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when fetch throws", async () => {
    (fetch as any).mockRejectedValue(new Error("network down"));
    const result = await fetchAddressBalance("https://horizon.example", ADDR);
    expect(result).toEqual({ status: "error" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/address-balances/fetchers.test.ts`
Expected: FAIL — `Cannot find module '@/lib/address-balances/fetchers'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/address-balances/fetchers.ts
import { calcAvailableXlm, type RawHorizonAccount } from "@/lib/stellar-reserve";

const FETCH_TIMEOUT_MS = 15_000;

export type AddressBalanceResult =
  | { status: "unfunded" }
  | { status: "error" }
  | { status: "ok"; total: number; available: number };

/**
 * Fetches the raw Horizon account JSON directly (not via fetchXlmBalance,
 * which only returns a bare balance number) — the reserve/available calc
 * needs subentry_count, num_sponsoring, num_sponsored, and selling_liabilities.
 */
export async function fetchAddressBalance(
  horizonUrl: string,
  address: string,
  signal?: AbortSignal,
): Promise<AddressBalanceResult> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`, {
      signal: controller.signal,
    });
    if (res.status === 404) return { status: "unfunded" };
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as RawHorizonAccount;
    const { total, available } = calcAvailableXlm(data);
    return { status: "ok", total, available };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/address-balances/fetchers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/address-balances/fetchers.ts tests/lib/address-balances/fetchers.test.ts
git commit -m "feat: add fetchAddressBalance for Address Balances module"
```

---

### Task 3: `scan_key` column — isolate Bulk Asset Sales and Address Balances scan state

**Files:**
- Modify: `lib/db.ts:195-200` (bulk_scan_state table definition), `lib/db.ts:588-594` (add versioned migration block), `lib/db.ts:605` (bump `CURRENT_SCHEMA_VERSION`)
- Modify: `supabase-schema.sql:32` (bulk_scan_state table definition)
- Modify: `app/api/db/bulk-scan-state/route.ts` (GET/POST/DELETE — filter/key by `scan_key`)
- Modify: `hooks/use-bulk-scan-state.ts` (accept a `key` param, default `"default"`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `useBulkScanState<T>(key = "default")` — Task 4 calls `useBulkScanState<AddressRow>("address-balances")`. Existing call site `components/asset-sales/BulkAssetSalesTab.tsx` (`useBulkScanState<AssetRow>()`, no args) must keep working unchanged.

- [ ] **Step 1: Update the SQLite table definition + add a versioned migration**

`lib/db.ts` has a `CREATE TABLE IF NOT EXISTS` for `bulk_scan_state` — but that statement is a no-op on any DB file that already has the table (every local dev DB that's ever run Bulk Asset Sales), so editing only the `CREATE TABLE` text will silently fail to add the column locally. The codebase has a versioned migration mechanism for exactly this (`schema_version` table + `CURRENT_SCHEMA_VERSION`, currently `1`, documented at `lib/db.ts:599-605` but not yet used by any real migration) — use it here.

First, find the `bulk_scan_state` table (around line 195) and update the `CREATE TABLE` so **new** installs get the column immediately:

```typescript
    CREATE TABLE IF NOT EXISTS bulk_scan_state (
      id          TEXT    PRIMARY KEY,
      rows_json   TEXT    NOT NULL,
      interrupted INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );
```

Replace with:

```typescript
    CREATE TABLE IF NOT EXISTS bulk_scan_state (
      id          TEXT    PRIMARY KEY,
      scan_key    TEXT    NOT NULL DEFAULT 'default',
      rows_json   TEXT    NOT NULL,
      interrupted INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );
```

Note: `id` will now be built from `scan_key` in the route (e.g. `local:default`, `local:address-balances`) rather than the fixed `"local"` constant — see Step 3. This is a transient scan-state cache, not durable user data, so an old `id = "local"` row simply becomes orphaned/unused after this change — acceptable for a resume-scan cache.

Then find the "Schema version init" block (around `lib/db.ts:588-594`):

```typescript
  // ── Schema version init ───────────────────────────────────────────────────
  // All existing migrations have already run above (idempotent checks).
  // Stamp version 1 so new installs skip the legacy migration path going forward.
  const versionRow = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  if (!versionRow) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
  }

  return db;
}
```

Insert a versioned migration block **after** the version-init block and **before** `return db;`:

```typescript
  // ── Schema version init ───────────────────────────────────────────────────
  // All existing migrations have already run above (idempotent checks).
  // Stamp version 1 so new installs skip the legacy migration path going forward.
  const versionRow = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  if (!versionRow) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
  }

  // ── Versioned migration: bulk_scan_state.scan_key (v1 -> v2) ───────────────
  {
    const v = (db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number }).version;
    if (v < 2) {
      const cols = db.prepare("PRAGMA table_info(bulk_scan_state)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "scan_key")) {
        db.exec(`ALTER TABLE bulk_scan_state ADD COLUMN scan_key TEXT NOT NULL DEFAULT 'default'`);
      }
      db.prepare("UPDATE schema_version SET version = 2").run();
    }
  }

  return db;
}
```

Finally, bump the documented constant at `lib/db.ts:605`:

```typescript
export const CURRENT_SCHEMA_VERSION = 2;
```

- [ ] **Step 2: Update the Supabase schema**

In `supabase-schema.sql`, find line 32:

```sql
CREATE TABLE IF NOT EXISTS bulk_scan_state (user_id TEXT PRIMARY KEY, rows_json TEXT NOT NULL, interrupted BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL);
```

Replace with:

```sql
CREATE TABLE IF NOT EXISTS bulk_scan_state (user_id TEXT NOT NULL, scan_key TEXT NOT NULL DEFAULT 'default', rows_json TEXT NOT NULL, interrupted BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, scan_key));
```

(Primary key changes from `user_id` alone to the composite `(user_id, scan_key)` — this is a new/altered table shape. Since this file is the source-of-truth DDL run via Supabase's SQL editor and the table has no existing production rows tied to the app going live yet per project notes, no `ALTER TABLE` migration path is written — if the deployed Supabase project already has a `bulk_scan_state` table with old rows, those rows will need a manual `DROP TABLE bulk_scan_state;` before re-running this DDL. Flag this to the user after the task.)

- [ ] **Step 3: Update the API route**

Read the current file first: `app/api/db/bulk-scan-state/route.ts`. Replace its full contents with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

function localId(scanKey: string): string {
  return `local:${scanKey}`;
}

function getScanKey(req: NextRequest): string {
  return req.nextUrl.searchParams.get("scanKey") || "default";
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;
  const scanKey = getScanKey(req);

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("bulk_scan_state")
      .select("rows_json, interrupted, updated_at")
      .eq("user_id", userId!)
      .eq("scan_key", scanKey)
      .maybeSingle();
    if (!data) return NextResponse.json(null);
    return NextResponse.json({
      rowsJson: data.rows_json,
      interrupted: !!data.interrupted,
      updatedAt: data.updated_at,
    });
  }

  const row = getDb()
    .prepare("SELECT rows_json, interrupted, updated_at FROM bulk_scan_state WHERE id = ?")
    .get(localId(scanKey)) as { rows_json: string; interrupted: number; updated_at: number } | undefined;
  if (!row) return NextResponse.json(null);
  return NextResponse.json({
    rowsJson: row.rows_json,
    interrupted: !!row.interrupted,
    updatedAt: row.updated_at,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;
  const scanKey = getScanKey(req);

  let body: { rowsJson?: unknown; interrupted?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.rowsJson !== "string") {
    return NextResponse.json({ error: "rowsJson (string) required" }, { status: 400 });
  }
  const rowsJson = body.rowsJson;
  const interrupted = !!body.interrupted;
  const now = Date.now();

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("bulk_scan_state").upsert(
      { user_id: userId, scan_key: scanKey, rows_json: rowsJson, interrupted, updated_at: now },
      { onConflict: "user_id,scan_key" },
    );
    if (error) {
      console.error("[bulk-scan-state] POST failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb()
    .prepare(
      `INSERT INTO bulk_scan_state (id, scan_key, rows_json, interrupted, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scan_key = excluded.scan_key,
         rows_json = excluded.rows_json,
         interrupted = excluded.interrupted,
         updated_at = excluded.updated_at`,
    )
    .run(localId(scanKey), scanKey, rowsJson, interrupted ? 1 : 0, now);

  syncToSupabase(() =>
    getSupabase()!.from("bulk_scan_state").upsert(
      { user_id: userId, scan_key: scanKey, rows_json: rowsJson, interrupted, updated_at: now },
      { onConflict: "user_id,scan_key" },
    ),
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;
  const scanKey = getScanKey(req);

  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!
      .from("bulk_scan_state")
      .delete()
      .eq("user_id", userId!)
      .eq("scan_key", scanKey);
    if (error) {
      console.error("[bulk-scan-state] DELETE failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  getDb().prepare("DELETE FROM bulk_scan_state WHERE id = ?").run(localId(scanKey));

  syncToSupabase(() =>
    getSupabase()!.from("bulk_scan_state").delete().eq("user_id", userId!).eq("scan_key", scanKey),
  );

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Update the hook to accept and send the key**

Read the current file first: `hooks/use-bulk-scan-state.ts`. Replace its full contents with:

```typescript
"use client";

import { useCallback, useRef } from "react";
import { authHeaders, waitForAuth } from "@/lib/db-client";

const BASE_ENDPOINT = "/api/db/bulk-scan-state";
const DEBOUNCE_MS = 1500;

function endpointFor(scanKey: string): string {
  return `${BASE_ENDPOINT}?scanKey=${encodeURIComponent(scanKey)}`;
}

function post(scanKey: string, rowsJson: string, interrupted: boolean) {
  return waitForAuth().then(() =>
    fetch(endpointFor(scanKey), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ rowsJson, interrupted }),
    }),
  );
}

/** DB-backed replacement for localStorage persistence of an in-progress scan's
 *  row state (survives refresh, and — unlike localStorage — syncs across devices
 *  in Supabase mode). Writes are debounced so rapid per-row status updates during
 *  a concurrent scan don't each trigger a network round-trip.
 *  `key` isolates independent scans (e.g. Bulk Asset Sales vs Address Balances)
 *  so they don't overwrite each other's saved state — defaults to "default" so
 *  existing callers with no key keep their prior behavior unchanged. */
export function useBulkScanState<T>(key: string = "default") {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<{ rows: T[]; interrupted: boolean } | null> => {
    try {
      await waitForAuth();
      const res = await fetch(endpointFor(key), { headers: authHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data.rowsJson !== "string") return null;
      return { rows: JSON.parse(data.rowsJson) as T[], interrupted: !!data.interrupted };
    } catch {
      return null;
    }
  }, [key]);

  /** Debounced save — call on every row update during an active scan. */
  const save = useCallback((rows: T[], interrupted = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      post(key, JSON.stringify(rows), interrupted).catch(() => {});
    }, DEBOUNCE_MS);
  }, [key]);

  /** Immediate, un-debounced save — call at batch start/finish so a checkpoint
   *  is never lost to a pending debounce timer that gets cleared by clear(). */
  const saveImmediate = useCallback((rows: T[], interrupted = false) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return post(key, JSON.stringify(rows), interrupted).catch(() => {});
  }, [key]);

  const clear = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return waitForAuth()
      .then(() => fetch(endpointFor(key), { method: "DELETE", headers: authHeaders() }))
      .catch(() => {});
  }, [key]);

  return { load, save, saveImmediate, clear };
}
```

- [ ] **Step 5: Verify locally with curl against the dev server**

First check there are no enabled auto-send/tiered-reward groups with short intervals before starting the dev server (per project safety note — `npm run dev` starts real cron schedulers):

Run: `sqlite3 stellar-toolkit.db "SELECT id, enabled, interval_minutes FROM auto_send_groups WHERE enabled = 1;" 2>/dev/null; sqlite3 stellar-toolkit.db "SELECT id, enabled, interval_minutes FROM tiered_reward_configs WHERE enabled = 1;" 2>/dev/null`
Expected: no rows, or only rows with long intervals you're OK triggering.

Per project memory, local dev's `.env` typically has `DB_PROVIDER=supabase` (Supabase branch + real JWT auth), which plain `curl` can't satisfy. Force the SQLite path for this curl check: `DB_PROVIDER="" npm run dev` (background) — this makes `requireAuth` bypass auth entirely for local dev (see `lib/supabase-server.ts` `requireAuth`: `if (!isSupabaseOnly()) return { ok: true, ... }`, no token needed). Then in another shell:

```bash
# default key (simulates Bulk Asset Sales)
curl -s -X POST http://localhost:3000/api/db/bulk-scan-state \
  -H "Content-Type: application/json" \
  -d '{"rowsJson":"[{\"a\":1}]","interrupted":false}'

# address-balances key
curl -s -X POST "http://localhost:3000/api/db/bulk-scan-state?scanKey=address-balances" \
  -H "Content-Type: application/json" \
  -d '{"rowsJson":"[{\"b\":2}]","interrupted":false}'

# read both back — must differ
curl -s http://localhost:3000/api/db/bulk-scan-state
curl -s "http://localhost:3000/api/db/bulk-scan-state?scanKey=address-balances"
```

Expected: the two GETs return different `rowsJson` (`[{"a":1}]` vs `[{"b":2}]`) — confirms isolation and confirms the SQLite migration in Step 1 actually applied (a missing `scan_key` column would throw a 500 on POST — check the dev server log if either curl fails).

Stop the dev server after verifying.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts supabase-schema.sql app/api/db/bulk-scan-state/route.ts hooks/use-bulk-scan-state.ts
git commit -m "feat: key bulk-scan-state by scan_key so modules don't clobber each other"
```

---

### Task 4: `AddressBalancesPanel.tsx` — the module UI

**Files:**
- Create: `components/address-balances/AddressBalancesPanel.tsx`

**Interfaces:**
- Consumes: `fetchAddressBalance`, `AddressBalanceResult` from `@/lib/address-balances/fetchers` (Task 2); `useBulkScanState<T>(key)` from `@/hooks/use-bulk-scan-state` (Task 3); `parseAddresses` from `@/lib/format` (existing); `useSettings`, `resolveHorizonUrl` from `@/lib/settings` (existing); `<ShortAddress>` from `@/components/shared/ShortAddress` (existing); `formatXlm` from `@/lib/format` (existing).
- Produces: `AddressBalancesPanel` React component — Task 5 renders it from `page.tsx`.

- [ ] **Step 1: Write the component**

```tsx
// components/address-balances/AddressBalancesPanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm, parseAddresses } from "@/lib/format";
import { useBulkScanState } from "@/hooks/use-bulk-scan-state";
import { fetchAddressBalance } from "@/lib/address-balances/fetchers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AddressRowStatus = "pending" | "loading" | "done" | "error" | "unfunded";

interface AddressRow {
  address: string;
  status: AddressRowStatus;
  total?: number;
  available?: number;
  error?: string;
}

const SCAN_KEY = "address-balances";
const CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Concurrency helper (same pattern as BulkAssetSalesTab.tsx)
// ---------------------------------------------------------------------------

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (index: number, item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (!signal.aborted) {
      const i = next++;
      if (i >= items.length) return;
      await fn(i, items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: AddressRowStatus }) {
  if (status === "pending")
    return <span className="text-xs text-muted-foreground">Pending</span>;
  if (status === "loading")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading…
      </span>
    );
  if (status === "done")
    return (
      <span className="text-xs text-green-600 dark:text-green-400">Done</span>
    );
  if (status === "unfunded")
    return (
      <span className="text-xs text-yellow-600 dark:text-yellow-400">
        Unfunded
      </span>
    );
  return <span className="text-xs text-destructive">Error</span>;
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function AddressBalancesPanel() {
  const { settings } = useSettings();
  const [addressesText, setAddressesText] = useState("");
  const [rows, setRows] = useState<AddressRow[]>([]);
  const [running, setRunning] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scanState = useBulkScanState<AddressRow>(SCAN_KEY);

  useEffect(() => {
    let cancelled = false;
    scanState.load().then((persisted) => {
      if (cancelled || !persisted || persisted.rows.length === 0) return;
      const wasInterrupted = persisted.rows.some(
        (r) => r.status === "pending" || r.status === "loading",
      );
      const restored = persisted.rows.map((r) =>
        r.status === "pending" || r.status === "loading"
          ? { ...r, status: "error" as AddressRowStatus, error: "Scan was interrupted (page refresh)." }
          : r,
      );
      setRows(restored);
      setInterrupted(wasInterrupted);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (index: number, patch: Partial<AddressRow>) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      scanState.save(next);
      return next;
    });
  };

  const handleRun = async () => {
    const addresses = parseAddresses(addressesText);
    if (addresses.length === 0) {
      setParseError("No valid Stellar addresses found. Enter one per line.");
      return;
    }
    const totalLines = addressesText.split("\n").filter((l) => l.trim().length > 0).length;
    setParseError(
      addresses.length < totalLines
        ? `${totalLines - addresses.length} invalid line(s) skipped.`
        : null,
    );
    setInterrupted(false);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const initial: AddressRow[] = addresses.map((address) => ({
      address,
      status: "pending",
    }));
    setRows(initial);
    scanState.saveImmediate(initial, false);
    setRunning(true);

    const horizonUrl = resolveHorizonUrl(settings);

    await runConcurrent(
      addresses,
      CONCURRENCY,
      async (i, address) => {
        updateRow(i, { status: "loading" });
        const result = await fetchAddressBalance(horizonUrl, address, signal);
        if (signal.aborted) return;
        if (result.status === "ok") {
          updateRow(i, { status: "done", total: result.total, available: result.available });
        } else if (result.status === "unfunded") {
          updateRow(i, { status: "unfunded" });
        } else {
          updateRow(i, { status: "error", error: "Failed to fetch balance." });
        }
      },
      signal,
    );

    setRunning(false);
    setRows((currentRows) => {
      scanState.saveImmediate(currentRows, false);
      return currentRows;
    });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setRunning(false);
    setRows([]);
    setInterrupted(false);
    scanState.clear();
  };

  const doneCount = rows.filter((r) => r.status === "done" || r.status === "unfunded").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter((r) => r.status === "pending" || r.status === "loading").length;

  // Watchdog: if running but all rows reached a terminal state, stop the spinner.
  useEffect(() => {
    if (running && rows.length > 0 && pendingCount === 0) {
      abortRef.current?.abort();
      setRunning(false);
    }
  }, [running, rows.length, pendingCount]);

  return (
    <div className="space-y-6">
      {interrupted && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-yellow-700 dark:text-yellow-400">
              Previous scan was interrupted
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The page was refreshed while a scan was running. Completed results
              are shown below. Start a new scan or clear to reset.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setInterrupted(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Address List
          </CardTitle>
          <CardDescription>
            One Stellar address (<code className="text-xs">G...</code>) per line.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addresses-input">Addresses</Label>
            <textarea
              id="addresses-input"
              className="w-full min-h-36 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
              placeholder={"GABC...\nGDEF...\nGHIJ..."}
              value={addressesText}
              onChange={(e) => {
                setAddressesText(e.target.value);
                setParseError(null);
              }}
              disabled={running}
            />
            {parseError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {parseError}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex gap-2 flex-wrap">
          <Button onClick={handleRun} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Check Balances
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!running}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          {rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={running}
              className="text-muted-foreground"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
          {rows.length > 0 && !running && (
            <span className="text-xs text-muted-foreground ml-auto self-center">
              {doneCount} done · {errorCount} failed
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
          )}
        </CardFooter>
      </Card>

      {running && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">
              {pendingCount === 0
                ? "Finalising…"
                : `Checking ${Math.min(doneCount + errorCount + 1, rows.length)} of ${rows.length}…`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {doneCount} done · {errorCount} failed · results are saved
              automatically if you navigate away
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      )}

      {rows.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance (XLM)</TableHead>
                <TableHead className="text-right">Available (XLM)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.address}>
                  <TableCell>
                    <ShortAddress
                      address={row.address}
                      network={settings.network as "public" | "testnet"}
                    />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                    {row.status === "error" && row.error && (
                      <p className="text-xs text-destructive mt-1">{row.error}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.status === "done" && row.total !== undefined
                      ? formatXlm(row.total)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.status === "done" && row.available !== undefined
                      ? formatXlm(row.available)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `components/address-balances/AddressBalancesPanel.tsx` or the files touched in Tasks 1–3.

- [ ] **Step 3: Commit**

```bash
git add components/address-balances/AddressBalancesPanel.tsx
git commit -m "feat: add AddressBalancesPanel UI"
```

---

### Task 5: Route, navigation entry, and end-to-end browser verification

**Files:**
- Create: `app/(tools)/address-balances/page.tsx`
- Modify: `lib/navigation.ts` (add menu entry in the "Wallets" section, after "Wallet Balances")

**Interfaces:**
- Consumes: `AddressBalancesPanel` from `@/components/address-balances/AddressBalancesPanel` (Task 4).
- Produces: nothing further downstream — this is the final integration task.

- [ ] **Step 1: Create the page shell**

```tsx
// app/(tools)/address-balances/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AddressBalancesPanel } from "@/components/address-balances/AddressBalancesPanel";

export default function AddressBalancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Address Balances</h1>
        <p className="text-muted-foreground mt-2">
          Paste a list of Stellar addresses to check their XLM balance and
          amount available to withdraw.
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
        <AddressBalancesPanel />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Add the navigation entry**

Read `lib/navigation.ts` first. In the `menuItems` array, find the "Wallets" section's "Wallet Balances" entry:

```typescript
  {
    title: "Wallet Balances",
    href: "/wallet-balances",
    icon: LayoutList,
  },
```

Add a new entry directly after it (before "Address Generator"):

```typescript
  {
    title: "Wallet Balances",
    href: "/wallet-balances",
    icon: LayoutList,
  },
  {
    title: "Address Balances",
    href: "/address-balances",
    icon: Search,
  },
```

Add `Search` to the existing `lucide-react` import list at the top of the file (it is not currently imported there).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `tests/lib/stellar-reserve.test.ts` and `tests/lib/address-balances/fetchers.test.ts`.

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

Check for enabled auto-send/tiered-reward groups with short intervals first (same safety check as Task 3 Step 5) before starting the dev server.

Run: `npm run dev`, then in a browser:
1. Navigate to `http://localhost:3000/address-balances`. Confirm the page renders with the standard module shell (h1 "Address Balances", description, no double max-width padding).
2. Confirm "Address Balances" appears in the sidebar under "Wallets", after "Wallet Balances".
3. Paste 2-3 known public-network addresses (e.g. a well-funded exchange address and a fresh unfunded `G...` address) into the textarea, click "Check Balances".
4. Confirm the table populates with Address (ShortAddress badge) / Status / Balance / Available columns; the unfunded address shows "Unfunded" status with "—" for balance/available.
5. Mid-scan (if addresses are slow to resolve) or immediately after, refresh the page — confirm the "Previous scan was interrupted" banner appears only if you refreshed while rows were still `pending`/`loading`; otherwise confirm completed results persist across the refresh.
6. Navigate to `/asset-sales?tab=bulk`, paste one `CODE:ISSUER` pair, run a scan, then refresh — confirm Bulk Asset Sales' own interrupted-scan/resume behavior still works unchanged (proves the `scan_key` change didn't break the existing module).
7. Close the dev server.

- [ ] **Step 6: Update CLAUDE.md**

Add a row to the Module Inventory table (alphabetical-ish, near "Wallet Balances"):

```markdown
| `address-balances` | Working, awaiting sign-off — paste a list of Stellar addresses, see XLM balance + available-to-withdraw per address (reserve/liabilities-aware, via new `lib/stellar-reserve.ts`); persists in-progress scans via `useBulkScanState("address-balances")` (scan_key isolation added so this doesn't clobber Bulk Asset Sales' own scan state) |
```

Add a short section (after "Wallet Balances", before "Local Dev & Testing Notes"):

```markdown
## Address Balances
- Route: `app/(tools)/address-balances/page.tsx`
- Panel: `components/address-balances/AddressBalancesPanel.tsx`
- **Purpose**: paste arbitrary Stellar addresses (not tied to saved wallets, unlike Wallet Balances) and see XLM balance + amount available to withdraw for each
- `lib/stellar-reserve.ts` — `calcAvailableXlm()`, pure reserve/available formula: `(2 + subentry_count) * 0.5 + sponsoring*0.5 - sponsored*0.5` reserved, minus native `selling_liabilities`. Extracted fresh (not shared with `my-wallet`/`payments`, which keep their own inline copies per module-stability rule)
- `lib/address-balances/fetchers.ts` — `fetchAddressBalance()`, one raw `/accounts/{address}` Horizon fetch per address, 15s timeout + abort-merge
- Persistence via `useBulkScanState<AddressRow>("address-balances")` — `hooks/use-bulk-scan-state.ts` now takes a `key` param (default `"default"`) so this module and Bulk Asset Sales don't overwrite each other's saved scan state; `bulk_scan_state` table gained a `scan_key` column (SQLite + Supabase) with row id `local:{scanKey}` / composite PK `(user_id, scan_key)`
- No CSV export, sort/filter, USD conversion, or per-row actions in this pass (deliberately out of scope — see spec)
```

- [ ] **Step 7: Commit**

```bash
git add "app/(tools)/address-balances/page.tsx" lib/navigation.ts CLAUDE.md
git commit -m "feat: add Address Balances module route, nav entry, and docs"
```
