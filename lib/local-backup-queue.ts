import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { isLocalRestoreActive, LocalRestoreBusyError } from "@/lib/local-restore-lock";

export interface BackupOperation {
  table: string;
  action: "upsert" | "update" | "delete" | "trim";
  data?: Record<string, unknown> | Record<string, unknown>[];
  match?: Record<string, unknown>;
  onConflict?: string;
  preserveExisting?: string[];
  keep?: number;
  orderColumn?: string;
}

const PARENTS: Record<string, string[]> = {
  asset_group_members: ["group_id:asset_groups"],
  person_addresses: ["person_id:persons"],
  person_relationships: ["person_a_id:persons", "person_b_id:persons"],
};
const TABLES = new Set([
  "address_book", "app_state", "bulk_recipients", "bulk_run_history", "bulk_scan_state",
  "creator_children", "asset_groups", "asset_group_members", "known_creators",
  "known_intermediaries", "persons", "person_addresses", "person_relationships",
  "saved_analyses", "saved_searches", "wallet_folders", "wallets",
]);
const REFERENCES: Record<string, string[]> = {
  wallets: ["folder_id:wallet_folders"],
  asset_groups: ["person_id:persons"],
};
declare global {
  var _localBackupDraining: Promise<void> | undefined;
  var _localBackupTimer: ReturnType<typeof setInterval> | undefined;
}

function checked(result: { error: unknown }): void {
  if (result.error) throw result.error;
}

async function ownedRow(sb: SupabaseClient, table: string, match: Record<string, unknown>, userId: string, preserve: string[] = []) {
  const columns = table === "person_relationships" ? "id,person_a_id,person_b_id"
    : PARENTS[table] ? `id,added_at,${PARENTS[table].map((relation) => relation.split(":")[0]).join(",")}` : "user_id";
  let query = sb.from(table).select([...new Set([...columns.split(","), ...preserve])].join(","));
  for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
  const result = await query.abortSignal(AbortSignal.timeout(30_000)).maybeSingle();
  checked(result);
  const row = result.data as Record<string, unknown> | null;
  if (!row) return null;
  if (!PARENTS[table]) {
    if (row.user_id !== userId) throw new Error("Backup record belongs to another user");
  } else {
    for (const relation of PARENTS[table]) {
      const [column, parent] = relation.split(":");
      if (!await ownedRow(sb, parent, { id: row[column] }, userId)) throw new Error("Backup parent is missing");
    }
  }
  return row;
}

async function execute(sb: SupabaseClient, operation: BackupOperation, userId: string): Promise<void> {
  if (!TABLES.has(operation.table)) throw new Error("Invalid backup table");
  const child = !!PARENTS[operation.table];
  if (operation.action === "upsert") {
    const rows = Array.isArray(operation.data) ? operation.data : [operation.data];
    for (const value of rows) {
      if (!value || typeof value !== "object") throw new Error("Invalid backup row");
      const row = { ...value };
      await checkReferences(sb, operation.table, row, userId);
      if (!child) row.user_id = userId;
      else for (const relation of PARENTS[operation.table]) {
        const [column, parent] = relation.split(":");
        if (!await ownedRow(sb, parent, { id: row[column] }, userId)) throw new Error("Backup parent is missing");
      }
      if (row.id !== undefined) await ownedRow(sb, operation.table, { id: row.id }, userId);
      if (operation.preserveExisting && operation.onConflict) {
        const match = Object.fromEntries(operation.onConflict.split(",").map((key) => [key, row[key]]));
        const existing = await ownedRow(sb, operation.table, match, userId, operation.preserveExisting);
        if (existing) for (const key of operation.preserveExisting) row[key] = existing[key];
      }
      checked(await sb.from(operation.table).upsert(row, operation.onConflict ? { onConflict: operation.onConflict } : undefined)
        .abortSignal(AbortSignal.timeout(30_000)));
    }
    return;
  }
  if (operation.action === "trim") {
    if (child || !Number.isInteger(operation.keep) || operation.keep! < 0 || !operation.orderColumn) throw new Error("Invalid backup trim");
    for (;;) {
      const result = await sb.from(operation.table).select("id").eq("user_id", userId)
        .order(operation.orderColumn, { ascending: false }).order("id", { ascending: false })
        .range(operation.keep!, operation.keep! + 499).abortSignal(AbortSignal.timeout(30_000));
      checked(result);
      if (!result.data?.length) return;
      checked(await sb.from(operation.table).delete().eq("user_id", userId).in("id", result.data.map((row) => row.id))
        .abortSignal(AbortSignal.timeout(30_000)));
    }
  }
  const match = { ...operation.match };
  if (!Object.keys(match).length) throw new Error("Backup mutations need a record filter");
  if (child) {
    if (!await ownedRow(sb, operation.table, match, userId)) return;
  } else match.user_id = userId;
  if (operation.action === "update" && (!operation.data || Array.isArray(operation.data))) throw new Error("Invalid backup update");
  if (operation.action === "update") await checkReferences(sb, operation.table, operation.data as Record<string, unknown>, userId);
  let query = operation.action === "delete" ? sb.from(operation.table).delete() : sb.from(operation.table).update(operation.data!);
  for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
  checked(await query.abortSignal(AbortSignal.timeout(30_000)));
}

async function checkReferences(sb: SupabaseClient, table: string, row: Record<string, unknown>, userId: string) {
  for (const relation of REFERENCES[table] ?? []) {
    const [column, parent] = relation.split(":");
    if (row[column] != null && !await ownedRow(sb, parent, { id: row[column] }, userId)) throw new Error("Backup reference is not owned by this user");
  }
}

/** Persist with the local write; replay in order so a delayed upsert cannot undo a delete. */
export function enqueueLocalBackup(operations: BackupOperation | BackupOperation[], userId: string): void {
  if (isLocalRestoreActive()) throw new LocalRestoreBusyError();
  const db = getDb();
  if (!db.inTransaction) throw new Error("Local writes and backup jobs must share a transaction");
  db.prepare("INSERT INTO local_backup_queue (user_id, operations_json, created_at) VALUES (?, ?, ?)")
    .run(userId, JSON.stringify(Array.isArray(operations) ? operations : [operations]), Date.now());
}

export function drainLocalBackup(sb: SupabaseClient, userId: string): Promise<void> {
  if (isLocalRestoreActive()) return Promise.resolve();
  if (global._localBackupDraining) return global._localBackupDraining;
  const running = Promise.resolve().then(async () => {
    const db = getDb();
    for (;;) {
      const job = db.prepare("SELECT * FROM local_backup_queue WHERE user_id = ? ORDER BY id LIMIT 1").get(userId) as
        { id: number; operations_json: string; last_failed_at: number | null } | undefined;
      if (!job) return;
      try {
        const operations: BackupOperation[] = JSON.parse(job.operations_json);
        if (!Array.isArray(operations) || !operations.length) throw new Error("Invalid backup job");
        for (const operation of operations) await execute(sb, operation, userId);
        db.transaction(() => {
          db.prepare("DELETE FROM local_backup_queue WHERE id = ? AND user_id = ?").run(job.id, userId);
          if (job.last_failed_at) db.prepare("DELETE FROM local_backup_failure WHERE user_id = ? AND last_failed_at = ?")
            .run(userId, job.last_failed_at);
        })();
      } catch (error) {
        const now = Date.now();
        db.transaction(() => {
          db.prepare("UPDATE local_backup_queue SET last_failed_at = ? WHERE id = ?").run(now, job.id);
          db.prepare(`INSERT INTO local_backup_failure (user_id, last_failed_at) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET last_failed_at = excluded.last_failed_at`).run(userId, now);
        })();
        console.error("[supabase-sync] queued backup failed; it will be retried", error);
        return;
      }
    }
  }).finally(() => { if (global._localBackupDraining === running) global._localBackupDraining = undefined; });
  global._localBackupDraining = running;
  return running;
}

export function startLocalBackupWorker(sb: SupabaseClient, userId: string): void {
  if (!global._localBackupTimer) {
    global._localBackupTimer = setInterval(() => { void drainLocalBackup(sb, userId); }, 30_000);
    global._localBackupTimer.unref();
  }
  void drainLocalBackup(sb, userId);
}
