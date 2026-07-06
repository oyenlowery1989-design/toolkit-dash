import type { WatchEvent } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var _tracerWatchStarted: boolean | undefined;
}

// ── Pure core (unit-tested with an injected fetchPage) ──────────────────────

export interface PollResult {
  events: Omit<WatchEvent, "id" | "watchId" | "seen" | "createdAt">[];
  nextCursor: string | null;
}

function buildOperationsUrl(
  horizonBase: string,
  address: string,
  params: Record<string, string>,
): string {
  const qs = new URLSearchParams(params).toString();
  // Per project rules: ALWAYS /accounts/{address}/operations — NEVER /operations?account=.
  return `${horizonBase}/accounts/${encodeURIComponent(address)}/operations?${qs}`;
}

/**
 * Polls a single watched address for new create_account operations it funded.
 *
 * Seed (cursor === null): fetches the single latest create_account op (desc) purely to
 * establish a starting paging_token — emits NO events (no backfill of history).
 * Poll (cursor set): fetches ops ascending from the cursor, emits an event for every
 * record where `record.funder === address` is verified explicitly, and advances the
 * cursor to the last record's paging_token regardless of match (Horizon paging tokens
 * are sequential — every record advances the cursor, matched or not).
 */
export async function pollWatch(
  fetchPage: (url: string) => Promise<any>,
  horizonBase: string,
  address: string,
  cursor: string | null,
): Promise<PollResult> {
  if (cursor === null) {
    const url = buildOperationsUrl(horizonBase, address, {
      order: "desc",
      limit: "1",
      type: "create_account",
    });
    const page = await fetchPage(url);
    const records: any[] = page?._embedded?.records ?? [];
    const latest = records[0];
    return { events: [], nextCursor: latest?.paging_token ?? null };
  }

  const url = buildOperationsUrl(horizonBase, address, {
    order: "asc",
    limit: "200",
    type: "create_account",
    cursor,
  });
  const page = await fetchPage(url);
  const records: any[] = page?._embedded?.records ?? [];

  const events: PollResult["events"] = [];
  let nextCursor = cursor;
  for (const record of records) {
    if (record.funder === address) {
      events.push({
        eventType: "create_account",
        accountCreated: record.account,
        funder: record.funder,
        amount: record.starting_balance,
        txHash: record.transaction_hash,
        ledgerTime: record.created_at,
      });
    }
    nextCursor = record.paging_token ?? nextCursor;
  }
  return { events, nextCursor };
}

// ── Cron wiring (not unit-tested — mirrors lib/auto-send/scheduler.ts) ──────

function resolveHorizonBase(network: string): string {
  if (network === "public" || network === "testnet" || network === "futurenet") {
    const { HORIZON_URLS } = require("@/lib/settings") as typeof import("@/lib/settings");
    return HORIZON_URLS[network];
  }
  // "local" network has no server-known localHorizonUrl (that's a per-browser setting) —
  // fall back to testnet so the poller doesn't crash; local-network watches are a rare case.
  const { HORIZON_URLS } = require("@/lib/settings") as typeof import("@/lib/settings");
  return HORIZON_URLS.testnet;
}

/** Polls every enabled watch once, persisting new events and advancing cursors. */
export async function pollAllWatches(): Promise<void> {
  const { getDb } = require("@/lib/db") as typeof import("@/lib/db");
  const { fetchJson } = require("@/lib/horizon-fetch") as typeof import("@/lib/horizon-fetch");
  const db = getDb();

  const watches = db
    .prepare("SELECT * FROM tracer_watchlist WHERE enabled = 1")
    .all() as Record<string, unknown>[];

  for (const w of watches) {
    const watchId = w.id as string;
    try {
      const address = w.address as string;
      const network = (w.network as string) ?? "public";
      const cursor = (w.poll_cursor as string | null) ?? null;
      const horizonBase = resolveHorizonBase(network);

      const result = await pollWatch((url: string) => fetchJson(url), horizonBase, address, cursor);
      const now = Date.now();

      if (result.events.length > 0) {
        const insertIfNew = db.prepare(`
          INSERT INTO tracer_watch_events
            (id, watch_id, event_type, account_created, funder, amount, tx_hash, ledger_time, seen, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM tracer_watch_events WHERE watch_id = ? AND account_created = ?
          )
        `);
        for (const ev of result.events) {
          insertIfNew.run(
            crypto.randomUUID(),
            watchId,
            ev.eventType,
            ev.accountCreated,
            ev.funder ?? null,
            ev.amount ?? null,
            ev.txHash ?? null,
            ev.ledgerTime ?? null,
            now,
            watchId,
            ev.accountCreated,
          );
        }
      }

      db.prepare("UPDATE tracer_watchlist SET poll_cursor = ?, last_checked_at = ? WHERE id = ?").run(
        result.nextCursor,
        now,
        watchId,
      );
    } catch (err) {
      // Never let one bad watch abort the whole poll cycle.
      console.error(`[tracer-watcher] poll failed for watch ${watchId}:`, err);
    }
  }
}

/** Starts the 5-minute polling cron. No-op on Vercel (no persistent process) and idempotent per boot. */
export function startTracerWatcher(): void {
  if (process.env.VERCEL) return;
  if (global._tracerWatchStarted) return;
  global._tracerWatchStarted = true;

  const cron = require("node-cron") as typeof import("node-cron");
  cron.schedule("*/5 * * * *", () => {
    pollAllWatches().catch((err) => console.error("[tracer-watcher] pollAllWatches failed:", err));
  });
  console.log("[tracer-watcher] Scheduler started (*/5 * * * *)");
}
