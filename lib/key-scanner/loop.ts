import type { CheckResult, KeyScanNetwork, KeyScanState, KeyScanTailEntry } from "./types";
import { generateKeypair, checkAccount } from "./engine";

type ExistsResult = Extract<CheckResult, { status: "exists" }>;

declare global {
  // eslint-disable-next-line no-var
  var _keyScanLoop: KeyScanLoopSingleton | undefined;
  // eslint-disable-next-line no-var
  var _keyScanStarted: boolean | undefined;
}

interface KeyScanLoopSingleton {
  running: boolean;
  network: KeyScanNetwork;
  pacedRps: number;
  concurrency: number;
  totalGenerated: number;
  totalNotFound: number;
  totalFound: number;
  totalErrors: number;
  tail: KeyScanTailEntry[];
  startedAt: number | null;
  lastActivityAt: number | null;
  lastError: string | null;
  autoResumed: boolean;
  abortController: AbortController | null;
  nextSlotAt: number;
  consecutive429: number;
  dirty: boolean;
  checkpointTimer: ReturnType<typeof setTimeout> | null;
  workerGeneration: number;
}

const TAIL_CAP = 50;
const CHECKPOINT_DEBOUNCE_MS = 1500;
const MIN_PACED_RPS = 0.5;

// Inlined (not imported from @/lib/settings) — settings.ts pulls in a client-only
// `useSyncExternalStore` hook, and this module runs server-side via instrumentation.ts,
// so importing it would drag the client hook into the server bundle (RSC build error).
// Keep in sync with HORIZON_URLS in lib/settings.ts.
const HORIZON_BASE: Record<KeyScanNetwork, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

function getSingleton(): KeyScanLoopSingleton {
  if (!global._keyScanLoop) {
    global._keyScanLoop = {
      running: false,
      network: "public",
      pacedRps: 5,
      concurrency: 3,
      totalGenerated: 0,
      totalNotFound: 0,
      totalFound: 0,
      totalErrors: 0,
      tail: [],
      startedAt: null,
      lastActivityAt: null,
      lastError: null,
      autoResumed: false,
      abortController: null,
      nextSlotAt: Date.now(),
      consecutive429: 0,
      dirty: false,
      checkpointTimer: null,
      workerGeneration: 0,
    };
  }
  return global._keyScanLoop;
}

function pushTail(s: KeyScanLoopSingleton, entry: KeyScanTailEntry) {
  s.tail.push(entry);
  if (s.tail.length > TAIL_CAP) s.tail.splice(0, s.tail.length - TAIL_CAP);
}

function ensureRow(): void {
  const { getDb } = require("@/lib/db") as typeof import("@/lib/db");
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO key_scan_state (id, network, running, resume_on_boot, paced_rps, concurrency, total_generated, total_not_found, total_found, total_errors, recent_tail_json, started_at, last_activity_at, last_error)
     VALUES ('local', 'public', 0, 1, 5, 3, 0, 0, 0, 0, '[]', NULL, NULL, NULL)`,
  ).run();
}

function loadRow(): Record<string, unknown> {
  const { getDb } = require("@/lib/db") as typeof import("@/lib/db");
  ensureRow();
  return getDb().prepare("SELECT * FROM key_scan_state WHERE id = 'local'").get() as Record<string, unknown>;
}

function checkpoint(s: KeyScanLoopSingleton): void {
  const { getDb } = require("@/lib/db") as typeof import("@/lib/db");
  ensureRow();
  getDb()
    .prepare(
      `UPDATE key_scan_state SET
         network = ?, running = ?, paced_rps = ?, concurrency = ?,
         total_generated = ?, total_not_found = ?, total_found = ?, total_errors = ?,
         recent_tail_json = ?, started_at = ?, last_activity_at = ?, last_error = ?
       WHERE id = 'local'`,
    )
    .run(
      s.network,
      s.running ? 1 : 0,
      s.pacedRps,
      s.concurrency,
      s.totalGenerated,
      s.totalNotFound,
      s.totalFound,
      s.totalErrors,
      JSON.stringify(s.tail),
      s.startedAt,
      s.lastActivityAt,
      s.lastError,
    );
  s.dirty = false;
}

function scheduleCheckpoint(s: KeyScanLoopSingleton): void {
  s.dirty = true;
  if (s.checkpointTimer) return;
  s.checkpointTimer = setTimeout(() => {
    s.checkpointTimer = null;
    if (s.dirty) checkpoint(s);
  }, CHECKPOINT_DEBOUNCE_MS);
}

function flushCheckpoint(s: KeyScanLoopSingleton): void {
  if (s.checkpointTimer) {
    clearTimeout(s.checkpointTimer);
    s.checkpointTimer = null;
  }
  checkpoint(s);
}

function insertHit(s: KeyScanLoopSingleton, publicKey: string, secretKey: string, result: ExistsResult): void {
  const { getDb } = require("@/lib/db") as typeof import("@/lib/db");
  const xlm = result.balances.find((b) => b.asset_type === "native")?.balance;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO key_scan_hits
         (id, public_key, secret_key, network, xlm_balance, balances_json, sequence, subentry_count, found_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      publicKey,
      secretKey,
      s.network,
      xlm ? parseFloat(xlm) : null,
      JSON.stringify(result.balances),
      result.sequence,
      result.subentryCount,
      Date.now(),
    );
}

async function acquireSlot(s: KeyScanLoopSingleton): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, s.nextSlotAt - now);
  const interval = 1000 / Math.max(s.pacedRps, MIN_PACED_RPS);
  s.nextSlotAt = Math.max(now, s.nextSlotAt) + interval;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function worker(s: KeyScanLoopSingleton, index: number, generation: number, signal: AbortSignal): Promise<void> {
  while (s.running && s.workerGeneration === generation && index < s.concurrency) {
    try {
      await acquireSlot(s);
      const { publicKey, secretKey } = generateKeypair();
      const result = await checkAccount(HORIZON_BASE[s.network], publicKey, signal);
      s.lastActivityAt = Date.now();

      if (result.status === "exists") {
        insertHit(s, publicKey, secretKey, result);
        s.totalFound++;
        s.totalGenerated++;
        s.consecutive429 = 0;
        pushTail(s, { publicKey, result: "found", at: Date.now() });
        flushCheckpoint(s);
      } else if (result.status === "not-found") {
        s.totalNotFound++;
        s.totalGenerated++;
        s.consecutive429 = 0;
        pushTail(s, { publicKey, result: "not-found", at: Date.now() });
        scheduleCheckpoint(s);
      } else {
        s.totalErrors++;
        s.lastError = result.message;
        pushTail(s, { publicKey, result: "error", at: Date.now() });
        if (/429/.test(result.message)) {
          s.consecutive429++;
          if (s.consecutive429 >= 5) {
            s.pacedRps = Math.max(MIN_PACED_RPS, s.pacedRps / 2);
            s.consecutive429 = 0;
            s.lastError = `Throttled by Horizon — pace reduced to ${s.pacedRps} req/s`;
          }
        } else {
          s.consecutive429 = 0;
        }
        scheduleCheckpoint(s);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") break;
      s.totalErrors++;
      s.lastError = err instanceof Error ? err.message : String(err);
      scheduleCheckpoint(s);
    }
  }
}

function spawnWorkers(s: KeyScanLoopSingleton): void {
  const generation = s.workerGeneration;
  const signal = s.abortController!.signal;
  for (let i = 0; i < s.concurrency; i++) {
    worker(s, i, generation, signal).catch((err) => console.error("[key-scanner] worker crashed:", err));
  }
}

export function startKeyScanLoopRun(): void {
  const s = getSingleton();
  if (s.running) return;
  s.running = true;
  s.abortController = new AbortController();
  s.workerGeneration++;
  s.startedAt = s.startedAt ?? Date.now();
  s.lastError = null;
  flushCheckpoint(s);
  spawnWorkers(s);
}

export function stopKeyScanLoopRun(): void {
  const s = getSingleton();
  s.running = false;
  s.abortController?.abort();
  s.abortController = null;
  flushCheckpoint(s);
}

export function updateKeyScanConfig(patch: { network?: KeyScanNetwork; pacedRps?: number; concurrency?: number; resumeOnBoot?: boolean }): void {
  const s = getSingleton();
  const growingConcurrency = patch.concurrency !== undefined && patch.concurrency > s.concurrency;
  if (patch.network !== undefined) s.network = patch.network;
  if (patch.pacedRps !== undefined) s.pacedRps = Math.max(MIN_PACED_RPS, patch.pacedRps);
  if (patch.concurrency !== undefined) s.concurrency = Math.max(1, patch.concurrency);
  if (patch.resumeOnBoot !== undefined) {
    const { getDb } = require("@/lib/db") as typeof import("@/lib/db");
    ensureRow();
    getDb().prepare("UPDATE key_scan_state SET resume_on_boot = ? WHERE id = 'local'").run(patch.resumeOnBoot ? 1 : 0);
  }
  if (growingConcurrency && s.running && s.abortController) {
    spawnWorkers(s);
  }
  flushCheckpoint(s);
}

export function getKeyScanState(): KeyScanState {
  const row = loadRow();
  const s = getSingleton();
  return {
    id: "local",
    network: (row.network as KeyScanNetwork) ?? s.network,
    running: !!row.running,
    resumeOnBoot: !!row.resume_on_boot,
    pacedRps: (row.paced_rps as number) ?? s.pacedRps,
    concurrency: (row.concurrency as number) ?? s.concurrency,
    totalGenerated: row.total_generated as number,
    totalNotFound: row.total_not_found as number,
    totalFound: row.total_found as number,
    totalErrors: row.total_errors as number,
    recentTail: JSON.parse((row.recent_tail_json as string) ?? "[]"),
    startedAt: (row.started_at as number) ?? null,
    lastActivityAt: (row.last_activity_at as number) ?? null,
    lastError: (row.last_error as string) ?? null,
    autoResumed: s.autoResumed,
  };
}

/** Starts the key-scanner. No-op on Vercel (no persistent process) and idempotent per boot. */
export function startKeyScanLoop(): void {
  if (process.env.VERCEL) return;
  if (global._keyScanStarted) return; // already resumed this boot (HMR/race guard)
  global._keyScanStarted = true;

  const s = getSingleton();
  const row = loadRow();
  s.network = (row.network as KeyScanNetwork) ?? "public";
  s.pacedRps = (row.paced_rps as number) ?? 5;
  s.concurrency = (row.concurrency as number) ?? 3;
  s.totalGenerated = (row.total_generated as number) ?? 0;
  s.totalNotFound = (row.total_not_found as number) ?? 0;
  s.totalFound = (row.total_found as number) ?? 0;
  s.totalErrors = (row.total_errors as number) ?? 0;
  s.tail = JSON.parse((row.recent_tail_json as string) ?? "[]");
  s.startedAt = (row.started_at as number) ?? null;
  s.lastActivityAt = (row.last_activity_at as number) ?? null;

  const wasRunning = !!row.running;
  const resumeOnBoot = !!row.resume_on_boot;
  if (wasRunning && resumeOnBoot) {
    s.autoResumed = true;
    startKeyScanLoopRun();
    console.log("[key-scanner] Auto-resumed previous run on boot");
  }
}
