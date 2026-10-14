import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { isLocalRestoreActive, isLocalDataBlocked, LocalRestoreBusyError, withLocalRestoreLock } from "@/lib/local-restore-lock";
import type { AutoSendGroup } from "@/lib/auto-send/types";
import type { TieredRewardConfig } from "@/lib/tiered-rewards/types";

const acquire = vi.hoisted(() => vi.fn());
vi.mock("@/lib/run-lease", () => ({ acquireRunLease: acquire, releaseRunLease: vi.fn() }));

afterEach(() => {
  global._localRestoreActive = false;
  global._localBackupDraining = undefined;
  global._autoSendExecutingGroups?.clear();
  global._autoSendLoggingGroups?.clear();
  global._autoSendRunningGroups?.clear();
  global._tieredRewardsRunningConfigs?.clear();
  global._tieredRewardsSchedulingConfigs?.clear();
  acquire.mockClear();
});

it("holds exclusion across awaits, rejects overlap, and releases after success", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const running = withLocalRestoreLock(async () => { expect(isLocalRestoreActive()).toBe(true); await held; return "done"; });
  expect(isLocalRestoreActive()).toBe(true);
  await expect(withLocalRestoreLock(async () => "overlap")).rejects.toBeInstanceOf(LocalRestoreBusyError);
  release();
  await expect(running).resolves.toBe("done");
  expect(isLocalRestoreActive()).toBe(false);
});

it("releases the lock when restore fails", async () => {
  await expect(withLocalRestoreLock(async () => { throw new Error("RPC rejected"); })).rejects.toThrow("RPC rejected");
  expect(isLocalRestoreActive()).toBe(false);
});

it("rejects restore while backup replay or payment automation is active", async () => {
  global._localBackupDraining = Promise.resolve();
  await expect(withLocalRestoreLock(async () => undefined)).rejects.toThrow("backup sync or payment run");
  global._localBackupDraining = undefined;
  for (const key of ["_autoSendExecutingGroups", "_autoSendLoggingGroups", "_autoSendRunningGroups", "_tieredRewardsRunningConfigs", "_tieredRewardsSchedulingConfigs"] as const) {
    global[key] = new Set(["running"]);
    await expect(withLocalRestoreLock(async () => undefined)).rejects.toThrow("backup sync or payment run");
    global[key]!.clear();
  }
  expect(isLocalRestoreActive()).toBe(false);
});

it("prevents both payment runners from acquiring leases during restore", async () => {
  const { runGroup } = await import("@/lib/auto-send/runner");
  const { runConfig } = await import("@/lib/tiered-rewards/runner");
  await withLocalRestoreLock(async () => {
    await expect(runGroup({ id: "group" } as AutoSendGroup)).rejects.toThrow("local restore");
    await expect(runConfig({ id: "config" } as TieredRewardConfig, [])).resolves.toEqual({ error: "A local restore is in progress. Try again after it finishes." });
    expect(acquire).not.toHaveBeenCalled();
    expect(global._autoSendExecutingGroups?.size ?? 0).toBe(0);
    expect(global._tieredRewardsRunningConfigs?.size ?? 0).toBe(0);
  });
});

it("allows SELECT during maintenance while blocking new and pre-prepared writes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "stellar-maintenance-write-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(directory, "test.db"));
  vi.resetModules();
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.exec("CREATE TABLE write_guard_test (value TEXT)");
  const prepared = db.prepare("INSERT INTO write_guard_test (value) VALUES (?)");
  const returning = db.prepare("INSERT INTO write_guard_test (value) VALUES (?) RETURNING value");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const running = withLocalRestoreLock(async () => {
    expect(isLocalDataBlocked()).toBe(false);
    prepared.run("maintenance");
    await held;
    expect(isLocalDataBlocked()).toBe(false);
    expect(getDb()).toBe(db);
  });
  try {
    expect(isLocalDataBlocked()).toBe(true);
    expect(getDb()).toBe(db);
    expect(db.prepare("SELECT value FROM write_guard_test").all()).toEqual([{ value: "maintenance" }]);
    expect(() => prepared.run("blocked")).toThrow("local restore");
    expect(() => returning.get("blocked")).toThrow("local restore");
    expect(() => returning.all("blocked")).toThrow("local restore");
    expect(() => returning.iterate("blocked")).toThrow("local restore");
    expect(() => db.prepare("DELETE FROM write_guard_test").run()).toThrow("local restore");
    expect(() => db.exec("DELETE FROM write_guard_test")).toThrow("local restore");
    expect(() => db.transaction(() => prepared.run("transaction-blocked"))()).toThrow("local restore");
    expect(db.inTransaction).toBe(false);
    expect(db.prepare("SELECT count(*) AS count FROM write_guard_test").get()).toEqual({ count: 1 });
    release();
    await running;
    expect(isLocalDataBlocked()).toBe(false);
    prepared.run("after-maintenance");
    expect(db.prepare("SELECT count(*) AS count FROM write_guard_test").get()).toEqual({ count: 2 });
  } finally {
    release();
    await running;
    db.close();
    global._stellarDb = undefined;
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
