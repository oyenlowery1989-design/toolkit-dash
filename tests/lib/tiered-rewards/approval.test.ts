import { beforeEach, afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ rows: new Map<string, string>(), failInsert: false, failUpdate: false }));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("Unexpected SQLite access"); } }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => true, getSupabase: () => ({ from: () => ({
  insert: async (row: { resource_id: string; lease_token: string }) => {
    if (storage.failInsert) return { error: { message: "offline" } };
    if (storage.rows.has(row.resource_id)) return { error: { code: "23505" } };
    storage.rows.set(row.resource_id, row.lease_token); return { error: null };
  },
  select: () => query(), update: (value: { lease_token: string }) => query(value),
}) }) }));
function query(value?: { lease_token: string }) {
  const filters: Record<string, string> = {};
  const q = {
    eq: (key: string, expected: string) => { filters[key] = expected; return q; },
    maybeSingle: async () => ({ data: storage.rows.has(filters.resource_id) ? { lease_token: storage.rows.get(filters.resource_id) } : null, error: null }),
    select: async () => {
      if (storage.failUpdate) return { data: null, error: { message: "offline" } };
      if (storage.rows.get(filters.resource_id) !== filters.lease_token) return { data: [], error: null };
      storage.rows.set(filters.resource_id, value!.lease_token); return { data: [{ resource_id: filters.resource_id }], error: null };
    },
  }; return q;
}
import { createRewardApproval, executeRewardApproval, readRewardApproval, verifyRewardApproval } from "@/lib/tiered-rewards/approval";
beforeEach(() => { storage.rows.clear(); storage.failInsert = storage.failUpdate = false; vi.stubEnv("PREVIEW_APPROVAL_SECRET", "test-secret"); });
afterEach(() => vi.unstubAllEnvs());
it("records Supabase outcomes and prevents replay and cross-user access", async () => {
  const token = createRewardApproval("config", "owner", "digest")!;
  const execute = vi.fn().mockResolvedValue({ error: "No payment" });
  expect(verifyRewardApproval(token, "config", "owner", "digest")).toBe(true);
  await executeRewardApproval(token, "config", "owner", "digest", execute);
  expect(await readRewardApproval(token, "config", "owner")).toEqual({ configId: "config", userId: "owner", digest: "digest", outcome: { error: "No payment" } });
  expect(await readRewardApproval(token, "config", "other")).toBeNull();
  expect(await readRewardApproval(token, "other", "owner")).toBeNull();
  await executeRewardApproval(token, "config", "owner", "digest", execute); expect(execute).toHaveBeenCalledOnce();
});
it("leaves a permanent blocked approval on a thrown execution or outcome persistence failure", async () => {
  const token = createRewardApproval("config", "owner", "digest")!;
  storage.failUpdate = true;
  const execute = vi.fn().mockResolvedValue({ error: "Partial result" });
  await expect(executeRewardApproval(token, "config", "owner", "digest", execute)).rejects.toThrow("blocked");
  storage.failUpdate = false;
  expect(await readRewardApproval(token, "config", "owner")).toEqual({ configId: "config", userId: "owner", digest: "digest" });
  await executeRewardApproval(token, "config", "owner", "digest", execute); expect(execute).toHaveBeenCalledOnce();
  const second = createRewardApproval("config", "owner", "digest")!;
  await expect(executeRewardApproval(second, "config", "owner", "digest", async () => { throw new Error("crash"); })).rejects.toThrow("crash");
  expect(await readRewardApproval(second, "config", "owner")).toEqual({ configId: "config", userId: "owner", digest: "digest" });
});
it("fails closed before execution when the atomic Supabase claim fails", async () => {
  storage.failInsert = true; const execute = vi.fn();
  await expect(executeRewardApproval(createRewardApproval("config", "owner", "digest")!, "config", "owner", "digest", execute)).rejects.toThrow("claim");
  expect(execute).not.toHaveBeenCalled();
});
it("rejects expired or modified tokens", () => {
  const token = createRewardApproval("config", "owner", "digest")!;
  expect(verifyRewardApproval(`${token}a`, "config", "owner", "digest")).toBe(false);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
  expect(verifyRewardApproval(token, "config", "owner", "digest")).toBe(false);
  vi.restoreAllMocks();
});
