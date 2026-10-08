import Database from "better-sqlite3";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => false, getSupabase: () => null }));
import { reserveExecution, finishExecution, deploymentUsage } from "@/lib/transaction-budget";
import { consumePreviewApproval } from "@/lib/preview-consumption";
import { claimSchedule } from "@/lib/scheduled-jobs";
beforeEach(() => {
  state.db?.close(); state.db = new Database(":memory:");
  state.db.exec("CREATE TABLE used_preview_approvals(hash TEXT PRIMARY KEY, consumed_at INTEGER); CREATE TABLE mainnet_executions(hash TEXT PRIMARY KEY,source TEXT,stroops INTEGER,status TEXT,result_json TEXT,created_at INTEGER); CREATE TABLE scheduled_jobs(kind TEXT,resource_id TEXT,interval_minutes INTEGER,next_run_at INTEGER,PRIMARY KEY(kind,resource_id))");
});
afterAll(() => state.db?.close());
describe("durable budget", () => {
  it("serializes competing reservations across different jobs/accounts", async () => {
    const result = await Promise.allSettled([reserveExecution("a", "source-a", 60n, 100n), reserveExecution("b", "source-b", 60n, 100n)]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("does not spend budget twice for a replayed transaction hash", async () => {
    expect(await reserveExecution("a", "source", 60n, 100n)).toBe(true);
    expect(await reserveExecution("a", "source", 60n, 100n)).toBe(false);
  });
  it("blocks uncertain sources and retains their holds after 24h", async () => {
    await reserveExecution("a", "source", 60n, 100n);
    await finishExecution("a", "unknown");
    state.db.prepare("UPDATE mainnet_executions SET created_at=0").run();
    await expect(reserveExecution("b", "source", 1n, 100n)).rejects.toThrow("unresolved");
    expect(await deploymentUsage()).toBe(0.000006);
  });
  it("retains fees from confirmed ledger failures and surfaces persistence errors", async () => {
    await reserveExecution("a", "source", 60n, 100n);
    await finishExecution("a", "rejected", undefined, 10n);
    expect(await deploymentUsage()).toBe(0.000001);
    await expect(finishExecution("missing", "submitted")).rejects.toThrow("missing");
  });
});
describe("persistent intervals", () => {
  it.each([90, 2880])("runs interval %im exactly once when due, surviving reinitialization", async (minutes) => {
    expect(await claimSchedule("auto", "id", minutes, false, 0)).toBe(false);
    expect(await claimSchedule("auto", "id", minutes, false, 10)).toBe(false);
    expect(await claimSchedule("auto", "id", minutes, true, minutes * 60_000 - 1)).toBe(false);
    expect(await claimSchedule("auto", "id", minutes, true, minutes * 60_000)).toBe(true);
    expect(await claimSchedule("auto", "id", minutes, true, minutes * 60_000)).toBe(false);
  });
});

it("consumes a verified preview once across concurrent requests", async () => {
  expect(await Promise.all([consumePreviewApproval("verified-token"), consumePreviewApproval("verified-token")])).toEqual([true, false]);
});
