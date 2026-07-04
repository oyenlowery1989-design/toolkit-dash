# Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix ~30 reliability findings from the 3-team analysis (fetcher backoff/case-sensitivity, persistence dual-mode drift + silent cache divergence, React abort-races/cleanup/stuck spinners).

**Architecture:** Three independent workstreams — A: shared Horizon fetch/submit helpers (`lib/horizon-fetch.ts`, `lib/stellar-submit.ts`) routed into existing fetchers/runners; B: `lib/db-client.ts` hardening + API route dual-mode fixes; C: shared `useAbortableRun` hook + surgical panel fixes. Every edit is a surgical bug fix — never restructure working modules.

**Tech Stack:** Next.js 15 App Router, React 19, stellar-sdk 13, better-sqlite3, Supabase JS, Vitest.

## Global Constraints

- **CLAUDE.md rules apply everywhere**: never force-uppercase asset codes in storage/display (compare with `.toUpperCase()` on BOTH sides only); `/accounts/{addr}/operations|payments` endpoints only; `parseFloat` not `parseInt`; log fetched URLs via `onLog`; never clear results on Stop; `shortAddr` from `lib/format.ts`.
- **Surgical edits only.** The repo has ~143 uncommitted files from prior work. `git add` ONLY the files your task touched — never `git add -A` / `git add .`.
- **Do not change any behavior of signed-off modules beyond the named fix.** If a fix requires wider refactor, stop and report instead.
- Before every edit: **Read the target file region first.** Line numbers below are from analysis and may drift ±20 lines; match on the quoted code, not the line number.
- Verify per task: `npx tsc --noEmit` must stay clean (or no worse than baseline — capture baseline first), and `npm run test` must pass. Vitest configured; put new tests in a `__tests__` dir next to the code or follow existing test file locations (check `git ls-files '*test*'` first and match).
- Commit after each task with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Workstream A — Fetchers / Stellar submit

### Task A1: Create shared `lib/horizon-fetch.ts` with 429/503 backoff

**Files:**
- Create: `lib/horizon-fetch.ts`
- Test: `lib/__tests__/horizon-fetch.test.ts`
- Reference (read first, do not modify yet): `lib/proceeds-investigator/fetchers.ts` (`fetchJson` ~L40-60), `lib/intermediary-tracer/fetchers.ts` (`fetchJson` L19-35)

**Interfaces:**
- Produces: `fetchJson(url: string, signal?: AbortSignal, opts?: { retries?: number; onLog?: (msg: string) => void }): Promise<any>` — throws `HorizonFetchError` (exported class with `.status`) after retries exhausted; retries 429/503/network-throw with exponential backoff (500ms, 1s, 2s, 4s; default 4 retries); rethrows `AbortError` immediately without retry.

- [ ] **Step 1: Read both existing `fetchJson` implementations** to copy their exact behavior (they are the proven pattern — port, don't reinvent). Note: intermediary-tracer's version lacks the trailing `throw` after the loop (finding F9) — the shared version MUST have it.

- [ ] **Step 2: Write failing test** `lib/__tests__/horizon-fetch.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, HorizonFetchError } from "../horizon-fetch";

afterEach(() => vi.restoreAllMocks());

describe("fetchJson", () => {
  it("returns parsed JSON on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    await expect(fetchJson("http://x")).resolves.toEqual({ ok: 1 });
  });

  it("retries 429 then succeeds", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers();
    const p = fetchJson("http://x");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: 2 });
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws HorizonFetchError after retries exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 503 })));
    vi.useFakeTimers();
    const p = fetchJson("http://x", undefined, { retries: 1 });
    p.catch(() => {}); // avoid unhandled rejection while timers run
    await vi.runAllTimersAsync();
    await expect(p).rejects.toBeInstanceOf(HorizonFetchError);
    vi.useRealTimers();
  });

  it("does NOT retry 404 — throws immediately", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nf", { status: 404 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("http://x")).rejects.toBeInstanceOf(HorizonFetchError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rethrows abort without retry", async () => {
    const err = new DOMException("aborted", "AbortError");
    const f = vi.fn().mockRejectedValue(err);
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("http://x")).rejects.toBe(err);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run lib/__tests__/horizon-fetch.test.ts` — expect FAIL (module not found).

- [ ] **Step 4: Implement** `lib/horizon-fetch.ts` (align details with the ported implementations from Step 1; this is the shape):

```ts
export class HorizonFetchError extends Error {
  constructor(public status: number, url: string) {
    super(`Horizon request failed (${status}): ${url}`);
    this.name = "HorizonFetchError";
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);

export async function fetchJson(
  url: string,
  signal?: AbortSignal,
  opts: { retries?: number; onLog?: (msg: string) => void } = {},
): Promise<any> {
  const retries = opts.retries ?? 4;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = 500 * 2 ** (attempt - 1);
      opts.onLog?.(`  retry ${attempt}/${retries} in ${delay}ms (HTTP ${lastStatus})`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
    }
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      lastStatus = 0; // network error — retryable
      if (attempt === retries) throw e;
      continue;
    }
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (!RETRYABLE.has(res.status)) throw new HorizonFetchError(res.status, url);
    if (attempt === retries) throw new HorizonFetchError(res.status, url);
  }
  throw new HorizonFetchError(lastStatus, url); // unreachable guard (finding F9)
}
```

- [ ] **Step 5: Run test — expect PASS.** Also `npx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(lib): add shared horizon-fetch with 429/503 backoff`

### Task A2: Route `lib/asset-lookup/fetchers.ts` through `fetchJson` + fix case-sensitivity + Promise.all (F1, F2, F3)

**Files:**
- Modify: `lib/asset-lookup/fetchers.ts` — raw `fetch()` loops at ~L349 (`inferDistribLite`), ~L545/L589 (`scanTradePair`), ~L653 (`scanAccountTrades`), ~L722 (`fetchOpenOfferAmount`), ~L836 (`fetchClaimableBalances`); case compare ~L432; `Promise.all` ~L759-776

**Interfaces:**
- Consumes: `fetchJson`, `HorizonFetchError` from Task A1.

- [ ] **Step 1: Read the whole file.** Map every raw `fetch(` call and every `if (!res.ok) break;`.
- [ ] **Step 2 (F1):** Replace each `const res = await fetch(url, { signal }); if (!res.ok) break; const json = await res.json();` pattern with:

```ts
let json: any;
try {
  json = await fetchJson(url, signal, { onLog });
} catch (e) {
  if (e instanceof DOMException && e.name === "AbortError") throw e;
  onLog?.(`  ⚠ page fetch failed after retries — results may be incomplete: ${String(e)}`);
  break; // same loop-exit as before, but only after retries AND with a visible log
}
```
Where the function has no `onLog` param, omit it. Keep all existing paging/cursor logic identical.
- [ ] **Step 3 (F2):** At ~L432 in `fetchPaymentTotals`, change:

```ts
// before
if (raw.asset_code !== assetCode || raw.asset_issuer !== issuerAddress) continue;
// after
if (
  String(raw.asset_code ?? "").toUpperCase() !== assetCode.toUpperCase() ||
  raw.asset_issuer !== issuerAddress
) continue;
```
- [ ] **Step 4 (F3):** At ~L759-776, change `Promise.all(...)` over per-account scans to `Promise.allSettled(...)`; for rejected entries, log via `onLog` and continue with fulfilled results only. Preserve result ordering/shape expected by callers (read the caller before editing).
- [ ] **Step 5: Verify** `npx tsc --noEmit` clean; `npm run test` passes. Manual smoke: not required here (covered by Task A5 verification).
- [ ] **Step 6: Commit** `fix(asset-lookup): retry/backoff on Horizon errors, case-insensitive asset compare, allSettled per-account scans`

### Task A3: Create `lib/stellar-submit.ts` — per-key mutex + bad_seq retry (F4, F5, F6)

**Files:**
- Create: `lib/stellar-submit.ts`
- Test: `lib/__tests__/stellar-submit.test.ts`
- Reference: `lib/bulk-payments/runner.ts:147-152` (reload-on-failure pattern), `lib/auto-send/runner.ts:317-340` (bad_seq retry pattern)

**Interfaces:**
- Produces:
  - `withAccountLock<T>(publicKey: string, fn: () => Promise<T>): Promise<T>` — chains per-key promises (in-memory mutex).
  - `isBadSeq(err: unknown): boolean` — true when Horizon result codes contain `tx_bad_seq`.

- [ ] **Step 1: Write failing test:**

```ts
import { describe, it, expect } from "vitest";
import { withAccountLock, isBadSeq } from "../stellar-submit";

describe("withAccountLock", () => {
  it("serializes calls for same key", async () => {
    const order: number[] = [];
    const slow = withAccountLock("G1", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    const fast = withAccountLock("G1", async () => { order.push(2); });
    await Promise.all([slow, fast]);
    expect(order).toEqual([1, 2]);
  });

  it("does not serialize different keys", async () => {
    const order: number[] = [];
    const a = withAccountLock("G1", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    const b = withAccountLock("G2", async () => { order.push(2); });
    await Promise.all([a, b]);
    expect(order).toEqual([2, 1]);
  });

  it("releases lock after a throwing fn", async () => {
    await expect(withAccountLock("G1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withAccountLock("G1", async () => 42)).resolves.toBe(42);
  });
});

describe("isBadSeq", () => {
  it("detects horizon tx_bad_seq shape", () => {
    expect(isBadSeq({ response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } })).toBe(true);
    expect(isBadSeq(new Error("random"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement:**

```ts
const locks = new Map<string, Promise<unknown>>();

export function withAccountLock<T>(publicKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(publicKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(publicKey, next.catch(() => {}));
  return next;
}

export function isBadSeq(err: unknown): boolean {
  const codes = (err as any)?.response?.data?.extras?.result_codes;
  return codes?.transaction === "tx_bad_seq";
}
```

- [ ] **Step 4: Run — PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(lib): stellar-submit account mutex + bad_seq detection`

### Task A4: Apply mutex/reload/bad_seq-retry to runners (F4, F5, F6)

**Files:**
- Modify: `lib/trustline-manager/index.ts` (~L168-214 `addTrustlineBulk`, ~L372-410 `drainAndRemoveBulk` custom-asset loop)
- Modify: `lib/auto-send/runner.ts` (`runGroup` entry)
- Modify: `lib/tiered-rewards/runner.ts` (`runConfig` entry + batch loop ~L159-181)

**Interfaces:**
- Consumes: `withAccountLock`, `isBadSeq` from Task A3.

- [ ] **Step 1 (F4 — trustline-manager):** Read both batch loops. In each `catch` around a batch submit, add the reload pattern already used in `lib/bulk-payments/runner.ts:147-152`:

```ts
} catch (e) {
  // resync sequence after failed batch — local builder already incremented it
  try { account = await server.loadAccount(publicKey); } catch { /* keep old; next batch will fail visibly */ }
  ...existing error handling unchanged...
}
```
(Match the actual variable names in the file; if `account` is `const`, change to `let`.)
- [ ] **Step 2 (F5 — run locks):** Wrap the body of `runGroup` in auto-send and `runConfig` in tiered-rewards:

```ts
export async function runGroup(group: AutoSendGroup): Promise<GroupRunResult> {
  return withAccountLock(walletPublicKeyOf(group), () => runGroupInner(group));
}
```
i.e. rename the existing function to `...Inner` and export a wrapper. Derive the public key exactly the way the existing code does (read first — likely `Keypair.fromSecret(group.secretKey).publicKey()`).
- [ ] **Step 3 (F6 — tiered batch bad_seq retry):** In the batch submit loop (~L159-181), mirror auto-send's retry (`lib/auto-send/runner.ts:317-340`): on `isBadSeq(e)`, reload account, rebuild the SAME batch once, resubmit; only abort tier if the retry also fails.
- [ ] **Step 4: Verify** `npx tsc --noEmit`; `npm run test`.
- [ ] **Step 5: Commit** `fix(runners): account mutex, reload-after-failed-batch, tiered bad_seq retry`

### Task A5: Paginate `fetchAccountOffersForAsset` (F8) + abort checks after SDK calls (F7)

**Files:**
- Modify: `lib/trustline-manager/index.ts` (~L500-534)
- Modify: `lib/asset-lookup/fetchers.ts` (`fetchAllHolders` ~L167, `fetchAccountCreator` ~L83, `fetchIssuerInfo` ~L126, `inferDistributionAddresses` ~L252, `fetchPaymentTotals` ~L421)
- Modify: `lib/tiered-rewards/fetcher.ts` (`fetchHolders` ~L44)

- [ ] **Step 1 (F8):** Convert the single `.limit(200).call()` in `fetchAccountOffersForAsset` to a paging loop:

```ts
let page = await server.offers().forAccount(account).limit(200).call();
const records = [...page.records];
while (page.records.length === 200) {
  page = await page.next();
  records.push(...page.records);
}
```
Then filter `records` exactly as before.
- [ ] **Step 2 (F7):** After each SDK `.call()`/`loadAccount` await inside loops in the listed functions, add `if (signal?.aborted) throw new DOMException("aborted", "AbortError");` (only where a `signal` param already exists — do NOT add new params).
- [ ] **Step 3: Verify** `npx tsc --noEmit`; `npm run test`.
- [ ] **Step 4: Commit** `fix(fetchers): paginate account offers, honor abort between SDK pages`

---

## Workstream B — Persistence

### Task B1: `lib/db-client.ts` — writes throw, GET failures don't fake empty (P6, P7, P9, low-listener)

**Files:**
- Modify: `lib/db-client.ts` (`load`/`reload` ~L104-135, `dbPost/dbPatch/dbDelete` ~L158-189, `stellardb:sync` listener ~L99)
- Test: `lib/__tests__/db-client.test.ts`

**Interfaces:**
- Produces (changed contract):
  - `dbPost/dbPatch/dbDelete` now **throw on `!res.ok` / network error** (still log). All call sites are fire-and-forget `void`/`.catch` style — grep `dbPost(`/`dbPatch(`/`dbDelete(` across `hooks/` and add `.catch(() => reloadCache())` rollback where a hook does optimistic `_cache.set` (reload-on-failure = simplest correct rollback).
  - `createDbCache.load()` on failure: cache stays `[]` but `isLoaded()` stays **false** and an `error: string | null` getter is exposed + one automatic retry after 3s. UI loading gates (`isLoaded`) then keep their spinner instead of rendering "no data".

- [ ] **Step 1: Read `lib/db-client.ts` fully.** Then grep all consumers: `grep -rn "dbPost\|dbPatch\|dbDelete\|createDbCache" hooks/ lib/ components/ | grep -v test`.
- [ ] **Step 2: Write failing tests** (happy path, throw-on-500 for `dbPost`, `isLoaded()===false` after failed `load`, retry succeeds on second attempt):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { dbPost, createDbCache } from "../db-client";

afterEach(() => vi.restoreAllMocks());

it("dbPost throws on 500", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
  await expect(dbPost("/api/db/groups", {})).rejects.toThrow();
});

it("failed load leaves isLoaded false", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
  const cache = createDbCache<{ id: string }>("/api/db/test-x");
  await cache.load().catch(() => {});
  expect(cache.isLoaded()).toBe(false);
});
```
(Adapt to the real `createDbCache` signature after reading the file.)
- [ ] **Step 3: Run — FAIL.** Implement: throw in `dbPost/dbPatch/dbDelete` after the existing `console.error`; in `load`/`reload` failure path do NOT set the loaded flag; schedule one `setTimeout(reload, 3000)` retry; expose `error()`. Fix P9 (`reload` returning in-flight `load`): if `loading`, chain `fetchPromise.then(() => doFetch())` instead of returning stale promise. Fix listener accumulation: move `stellardb:sync` listener registration to module scope or guard with a boolean.
- [ ] **Step 4: Update every optimistic hook write site** found in Step 1 grep: pattern `dbPost(url, body)` → `dbPost(url, body).catch(() => _cache.reload())` (match each hook's actual cache variable). Do NOT restructure hooks.
- [ ] **Step 5: Run tests + `npx tsc --noEmit`.** Then manual smoke: `npm run dev`, open Groups page, create + delete a group, verify list correct after hard reload.
- [ ] **Step 6: Commit** `fix(db-client): writes throw + reload-on-failure rollback; failed GET keeps loading state`

### Task B2: Dual-mode `user_id` fixes (P1, P3, P4)

**Files:**
- Modify: `lib/supabase-server.ts` (~L75-79 `requireAuth` / `syncToSupabase`)
- Modify: `app/api/db/restore/route.ts` (~L199-201 source="local")
- Modify: `app/api/db/startup-sync/route.ts` (~L42-55)
- Modify: `.env.example`

- [ ] **Step 1: Read `lib/supabase-server.ts` fully** — understand how cloud mode resolves the real user id.
- [ ] **Step 2 (P1):** In local dual-write mode, resolve user id as: `process.env.SUPABASE_SYNC_USER_ID ?? null`; if null, **skip the Supabase sync entirely** and `console.warn` ONCE per boot: `"[supabase-sync] skipped: set SUPABASE_SYNC_USER_ID to enable local→Supabase backup"`. Never write `user_id: null` rows. Implement in one place (the `syncToSupabase` helper), not per-route.
- [ ] **Step 3 (P3):** In `restore/route.ts` source="local": inject the resolved `user_id` into every row of each batch before `upsert(batch)`; if no user id resolvable, return 400 with a clear message instead of pushing doomed batches.
- [ ] **Step 4 (P4):** In `startup-sync/route.ts`: add `.eq("user_id", userId)` to every table read, resolving `userId` the same way `restore` does; if unresolvable, skip sync with the same warn.
- [ ] **Step 5:** Add to `.env.example`: `SUPABASE_SYNC_USER_ID= # local-dev only: user id used when backing up local SQLite to Supabase`.
- [ ] **Step 6: Verify** `npx tsc --noEmit`; boot `npm run dev` locally without the env var — confirm single warn, no Supabase writes attempted (watch server console).
- [ ] **Step 7: Commit** `fix(supabase-sync): never write null user_id; gate local backup behind SUPABASE_SYNC_USER_ID`

### Task B3: Route-level consistency fixes (P2, P8, P10, P12)

**Files:**
- Modify: `app/api/db/groups/route.ts` (POST `type:"group"` local branch ~L92-143)
- Modify: `app/api/db/auto-send-groups/route.ts` (destination upsert ~L104-118) + `hooks/use-auto-send-groups.ts` (~L95-108)
- Modify: `app/api/db/saved-searches/route.ts` (DELETE ~L120-124)
- Modify: `app/api/db/wallets-v2/route.ts` (~L70-80)

- [ ] **Step 1 (P2):** In groups POST `type:"group"` local branch, add the same `syncToSupabase(...)` call the member/PATCH/DELETE branches use (read those branches ~L208/259/327 and mirror exactly).
- [ ] **Step 2 (P8):** Make the auto-send destination upsert route **return the resolved row id** in its JSON response; in `hooks/use-auto-send-groups.ts` `upsertDestination`, after the (now-throwing, per B1) `dbPost` resolves, update the cached row's id with the server id (or simplest: `.then(() => _cache.reload())` — pick whichever matches the hook's existing style; reload is acceptable).
- [ ] **Step 3 (P10):** Change saved-searches DELETE to key on `id`: read the route + `hooks/use-search-history` / saved-searches hook to find what the client sends; pass `id` through and `DELETE ... WHERE id = ?` (SQLite) / `.eq("id", id)` (Supabase). Keep `created_at` fallback ONLY if some rows lack ids (check `lib/db.ts` schema first).
- [ ] **Step 4 (P12):** In wallets-v2 POST, apply the duplicate-`public_key` guard in the Supabase-only branch too (mirror the local guard at ~L70-80).
- [ ] **Step 5: Verify** `npx tsc --noEmit`; `npm run dev` smoke: create group (check server log shows supabase sync attempt or skip-warn), delete a saved search — only that one disappears after reload.
- [ ] **Step 6: Commit** `fix(api): sync group-create, stable destination ids, delete searches by id, dedupe wallets in supabase mode`

### Task B4: Run-log + last_run_at durability (P11, P14)

**Files:**
- Modify: `app/api/auto-send/run/route.ts` (~L74 insert, ~L112 throw path)
- Modify: `app/api/tiered-rewards/run/route.ts` (~L86-100)

- [ ] **Step 1 (P11):** `await` the Supabase run-log insert and check `.error`; on error, `console.error` AND include `logWriteFailed: true` in the route's JSON response. Move run-log writing into a `finally`-style block so the partial-failure throw path (~L112) still writes whatever log rows exist before rethrowing/500ing.
- [ ] **Step 2 (P14):** Persist `last_run_at` to BOTH stores when in local dual-write mode (mirror whichever tables already dual-write); replace the fire-and-forget `void sb...` with an awaited call + error check; on failure `console.error` with the group id (scheduler double-run risk — must be visible).
- [ ] **Step 3: Verify** `npx tsc --noEmit`.
- [ ] **Step 4: Commit** `fix(run-routes): durable run logs and last_run_at (prevent silent no-record / double payout)`

### Task B5: Migration guard split (P15) — LOW, mechanical

**Files:**
- Modify: `lib/db.ts` (~L291-359)

- [ ] **Step 1:** Wrap each `ALTER TABLE ... ADD COLUMN` in its own `try/catch` (catch = column exists, log at debug level) instead of one block-level try/catch. Do not touch the schema-version stamp (P16 is deliberate deferral — inert but harmless).
- [ ] **Step 2:** `npm run dev` boots clean; existing DB opens without errors.
- [ ] **Step 3: Commit** `fix(db): per-statement migration guards so one failure can't skip later columns`

---

## Workstream C — React state / UI

### Task C1: Create `hooks/use-abortable-run.ts` (foundation for U1, U2, U7)

**Files:**
- Create: `hooks/use-abortable-run.ts`
- Test: `hooks/__tests__/use-abortable-run.test.ts` (only if a React testing setup already exists — check `git ls-files | grep -i test` and `vitest.config`; if no jsdom/RTL setup, skip the test file and rely on typecheck + smoke)

**Interfaces:**
- Produces:

```ts
import { useCallback, useEffect, useRef } from "react";

/**
 * Abortable async runs: starting a new run aborts the previous one;
 * unmount aborts the current one. The callback receives the run's own
 * controller — check THAT signal after awaits, never a shared ref.
 */
export function useAbortableRun() {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        return await fn(controller.signal);
      } catch (e) {
        if (controller.signal.aborted) return undefined; // superseded or unmounted
        throw e;
      }
    },
    [],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { run, stop };
}
```

- [ ] **Step 1: Write the file exactly as above.**
- [ ] **Step 2:** `npx tsc --noEmit`.
- [ ] **Step 3: Commit** `feat(hooks): useAbortableRun — per-run signal, abort-previous, abort-on-unmount`

### Task C2: Fix abort-race + cleanup in investigator/proceeds/scan (U1, U2 part 1)

**Files:**
- Modify: `components/address-investigator/AddressInvestigatorTab.tsx` (guards ~L897, ~L970; refs ~L545-547)
- Modify: `components/proceeds-investigator/AssetXlmProceedsTab.tsx` (~L300, ~L327; Coingecko ~L314-319)
- Modify: `components/intermediary-tracer/ScanIntermediaryTab.tsx` (cleanup + Stop handler ~L336, toast-in-updater ~L169-171)

**Interfaces:**
- Consumes: `useAbortableRun` from C1 — **only if it drops in cleanly.** These are large signed-off files; the MINIMAL fix is acceptable and preferred where the hook doesn't fit the existing structure:

```ts
// minimal fix pattern (no hook): capture controller before awaits
const controller = new AbortController();
abortRef.current?.abort();
abortRef.current = controller;
...
await something(controller.signal);
if (controller.signal.aborted) return;   // NOT abortRef.current.signal.aborted
```
plus one unmount effect per component: `useEffect(() => () => { abortRef.current?.abort(); realCreatorAbortRef.current?.abort(); }, []);`

- [ ] **Step 1:** Read each `handleRun`-style function fully before editing. Apply the capture-controller pattern to EVERY `abortRef.current.signal.aborted` / post-await guard in these three files. Grep within each file: `grep -n "abortRef.current" <file>`.
- [ ] **Step 2 (proceeds):** In the catch that paints `setError` (~L327), first check `if (controller.signal.aborted) return;` so a superseded run can't paint an error over the new run. Guard the Coingecko `.then(setXlmUsdPrice)` with the same controller check.
- [ ] **Step 3 (scan tab):** Add the unmount cleanup effect; move the `toast.success` out of the `setResults` updater to after the state call (U14); in the Stop handler add `setRunning(false)` alongside the abort.
- [ ] **Step 4: Verify** `npx tsc --noEmit`; smoke in `npm run dev`: run address investigation on address A, immediately re-run with address B → results shown are B's; navigate away mid-run → no console setState warnings.
- [ ] **Step 5: Commit** `fix(panels): per-run abort controllers, unmount cleanup, no stale-run result clobbering`

### Task C3: Investigator stale URL results + misc panel fixes (U3, U7, wallet-balances leaks)

**Files:**
- Modify: `components/address-investigator/AddressInvestigatorTab.tsx` (~L503-505 URL param effect)
- Modify: `components/layout/header.tsx` (~L43-50)
- Modify: `components/wallet-balances/WalletBalancesPanel.tsx` (`retrySingle` ~L162, `handleAddWallet` ~L290)

- [ ] **Step 1 (U3):** In the `urlAddress` effect, when the param changes: set the input AND clear stale data — `setResult(null); setOperations([]); setHomeDomain(null); setBalancesTrustlines(...); setAddressChain(...)` (read the file for the exact state setters + their empty values), then call `handleRun` for the new address (auto-run matches the deep-link intent from wallet-balances "Investigate"). Guard with a ref so it fires once per param value.
- [ ] **Step 2 (U7):** In header's wallet-balance effect add the standard ignore flag:

```ts
useEffect(() => {
  let cancelled = false;
  ...loadAccount(pk).then((acc) => { if (!cancelled) setBalance(...); }).catch(() => { if (!cancelled) setBalance(null); });
  return () => { cancelled = true; };
}, [/* existing deps */]);
```
- [ ] **Step 3:** In WalletBalancesPanel, thread `abortRef.current?.signal` into `retrySingle`'s fetch and add a `cancelled`-flag guard in `handleAddWallet`'s post-await setState (match the panel's existing abort pattern).
- [ ] **Step 4: Verify** `npx tsc --noEmit`; smoke: click Investigate from wallet-balances → new address auto-runs, no stale rows; rapid wallet-switch in header shows correct balance.
- [ ] **Step 5: Commit** `fix(ui): deep-link resets+auto-runs investigator; race-guard header balance and wallet-balances fetches`

### Task C4: Auto-send panel fixes (U4, U5, U11, U12)

**Files:**
- Modify: `components/auto-send-groups/AutoSendGroupsPanel.tsx` (~L484 Save disabled; ~L768-789 `handleCheck`; ~L41-42/685/704 module Maps; ~L706/1072 `dismissedFailure`; ~L747-749 balance effect; ~L791-867 run/test timeout scope)

- [ ] **Step 1 (U4):** Change Save's `disabled={!name.trim() || !pubkey}` to use the existing `keyValid` (~L416) so keeping the stored key works: `disabled={!name.trim() || !keyValid}` (read `keyValid`'s definition to confirm it covers the blank-field + `group.hasKey` case).
- [ ] **Step 2 (U5):** Give `handleCheck` the same watchdog as `handleRun`: wrap `waitForAuth()` + fetch in a 60s `AbortController` + `setTimeout` and clear `checking` in `finally` on the OUTERMOST promise.
- [ ] **Step 3 (U12 timeout scope):** In `handleRun`/`handleTestRun` (~L791-867), move `await waitForAuth()` INSIDE the try whose `finally` clears `running`/`testRunning`, or race it: `await Promise.race([waitForAuth(), timeoutReject(60_000)])`.
- [ ] **Step 4 (U12 stale state):** Reset `dismissedFailure` when the failure identity changes: `useEffect(() => setDismissedFailure(false), [group.lastFailureAt]);` and reset `balance` to null when wallet/network changes: add the group's public key/network to the balance effect's identity (read effect ~L747 first; simplest: `useEffect(() => setBalance(null), [group.publicKey, group.network])`).
- [ ] **Step 5 (U11):** Clear `_runResults`/`_testResults` entries in the delete-group handler (`_runResults.delete(groupId)`).
- [ ] **Step 6: Verify** `npx tsc --noEmit`; smoke: edit a group WITHOUT re-entering secret → Save enabled; press Check with dev server's network throttled → clears within 60s.
- [ ] **Step 7: Commit** `fix(auto-send): editable groups keep stored key; watchdogs on check/run; reset latched failure/balance state`

### Task C5: Tiered-rewards panel fixes (U6, U13)

**Files:**
- Modify: `components/tiered-rewards/TierConfigCard.tsx` (~L125 `excludeDraft`; ~L129-140 history effect; ~L461 onBlur)
- Modify: `components/tiered-rewards/TieredRewardsPanel.tsx` (~L36 `newNetwork`)
- Modify: `components/tiered-rewards/TierPreviewModal.tsx` (~L22 `sessionExcluded`)

- [ ] **Step 1 (U6 spinner):** Restructure the history load so `setHistoryLoading(false)` is in a `finally` on the whole chain including `waitForAuth()`; add a `cancelled` flag keyed to the effect's deps so a stale response can't overwrite a newer one.
- [ ] **Step 2 (U6 stale draft):** Re-sync draft on prop change: `useEffect(() => setExcludeDraft(config.excludeAddresses), [config.excludeAddresses]);` — but only when the field is not focused (guard with a `focusedRef` set in onFocus/onBlur) so typing isn't clobbered by a focus-reload.
- [ ] **Step 3 (U13):** `TieredRewardsPanel` — sync `newNetwork` when settings hydrate: `useEffect(() => setNewNetwork(settings.network ?? "public"), [settings.network]);` (only if user hasn't touched it — guard with a `touchedRef` set in the select's onChange). `TierPreviewModal` — reset `sessionExcluded` when the modal (re)opens: `useEffect(() => { if (open) setSessionExcluded(new Set()); }, [open]);` (read the component for the actual open-prop name).
- [ ] **Step 4: Verify** `npx tsc --noEmit`; smoke: open a tier card's history tab (loads + spinner clears), close/reopen preview modal (exclusions reset).
- [ ] **Step 5: Commit** `fix(tiered-rewards): history spinner finally+stale-guard, draft/prop resync, modal exclusion reset`

### Task C6: Hydration + storage-crash + low sweep (U8, U9, U10, lows)

**Files:**
- Modify: `components/bulk-asset-sales/BulkAssetSalesPanel.tsx` (~L326)
- Modify: `lib/settings.ts` (~L105), `hooks/use-search-history.ts` (~L47)
- Modify: `hooks/use-active-wallet.ts` (~L92-101)

- [ ] **Step 1 (U9):** Replace the localStorage-reading `useState(getInitialRowsState)` with `useState(EMPTY_STATE)` + a mount effect:

```ts
useEffect(() => {
  const persisted = getInitialRowsState();
  if (persisted.rows.length || persisted.interrupted) setRowsState(persisted);
}, []);
```
(match actual state names; keep SSR output = empty so hydration matches).
- [ ] **Step 2 (U10):** Wrap the `JSON.parse` in both `getSnapshot` paths in try/catch returning the default value (mirror how `loadFromStorage` in the same files already guards). CAUTION for `useSyncExternalStore`: the snapshot must be referentially stable across calls when unchanged — cache the parsed value keyed by raw string, don't parse per call:

```ts
let _lastRaw: string | null = null;
let _lastParsed: T = DEFAULT;
function getSnapshot(): T {
  const raw = localStorage.getItem(KEY);
  if (raw === _lastRaw) return _lastParsed;
  _lastRaw = raw;
  try { _lastParsed = raw ? JSON.parse(raw) : DEFAULT; } catch { _lastParsed = DEFAULT; }
  return _lastParsed;
}
```
(Read each file first — they may already cache; only add the try/catch where missing.)
- [ ] **Step 3 (U8):** Reset the self-heal latch when the active id changes: in `use-active-wallet.ts`, set `selfHealedRef.current = false` wherever `activeId` is (re)assigned to a non-null value (connect/switch paths), so a later ghost id can self-heal again.
- [ ] **Step 4: Verify** `npx tsc --noEmit`; smoke: reload bulk-asset-sales with persisted rows → no hydration warning in console; corrupt a localStorage key by hand (`localStorage.setItem("<settings key>", "{oops")`) → app renders with defaults, no white screen.
- [ ] **Step 5: Commit** `fix(ui): SSR-safe persisted state, crash-proof storage snapshots, resettable wallet self-heal`

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — clean (vs baseline captured before Task A1)
- [ ] `npm run test` — all pass
- [ ] `npm run build` — succeeds
- [ ] Manual smoke pass: asset lookup scan (watch activity log for retry lines instead of silent truncation), investigator deep-link, auto-send edit-without-key, bulk-asset-sales reload
- [ ] Re-read CLAUDE.md Module Inventory — confirm no signed-off module's behavior changed beyond the named fixes
