import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let testDir: string | undefined;

afterEach(() => {
  globalThis._stellarDb?.close();
  globalThis._stellarDb = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("local Supabase backup", () => {
  it("logs a query error returned in a resolved Supabase response", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    vi.stubEnv("SUPABASE_SYNC_USER_ID", "test-user");
    vi.stubEnv("DB_PROVIDER", "sqlite");
    vi.stubEnv("VERCEL", "");
    testDir = mkdtempSync(path.join(tmpdir(), "stellar-sync-test-"));
    vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { syncToSupabase } = await import("@/lib/supabase-server");

    syncToSupabase(() => Promise.resolve({ data: null, error: { message: "row rejected" } }));

    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledWith(
      "[supabase-sync]",
      { message: "row rejected" },
    ));
    const { getDb } = await import("@/lib/db");
    expect(getDb().prepare("SELECT last_failed_at FROM local_backup_failure WHERE user_id = ?").get("test-user")).toMatchObject({
      last_failed_at: expect.any(Number),
    });

    syncToSupabase(() => Promise.resolve({ error: null }));
    const { GET } = await import("@/app/api/db/status/route");
    expect(await (await GET()).json()).toMatchObject({ localBackupEnabled: true, backupFailed: true });
    vi.stubEnv("SUPABASE_SYNC_USER_ID", "other-user");
    expect(await (await GET()).json()).toMatchObject({ localBackupEnabled: true, backupFailed: false });

    syncToSupabase(() => { throw new Error("callback failed"); });
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledWith(
      "[supabase-sync]",
      expect.objectContaining({ message: "callback failed" }),
    ));
  });
});
