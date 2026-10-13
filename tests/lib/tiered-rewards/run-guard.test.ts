import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, type Horizon } from "stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ row: null as null | { resource_id: string; lease_token: string; expires_at: number }, failUpdate: false }));
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => true,
  getSupabase: () => ({ from: () => ({
    insert: async (row: NonNullable<typeof storage.row>) => {
      if (storage.row) return { error: { code: "23505" } };
      storage.row = row;
      return { error: null };
    },
    update: (value: { lease_token: string }) => mutation(value),
    delete: () => mutation(null),
    select: () => {
      const query = {
        eq: () => query,
        maybeSingle: async () => ({ data: storage.row ? { lease_token: storage.row.lease_token } : null, error: null }),
      };
      return query;
    },
  }) }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("Unexpected SQLite access"); } }));
function mutation(value: { lease_token: string } | null) {
  const filters: Record<string, unknown> = {};
  const query = {
    eq: (key: string, expected: unknown) => { filters[key] = expected; return query; },
    select: async () => {
      if (storage.failUpdate) return { error: { message: "offline" }, data: null };
      const matches = storage.row && Object.entries(filters).every(([key, expected]) => storage.row![key as keyof typeof storage.row] === expected);
      if (!matches) return { error: null, data: [] };
      storage.row = value ? { ...storage.row!, ...value } : null;
      return { error: null, data: [{ resource_id: filters.resource_id }] };
    },
  };
  return query;
}
import { claimRewardRun, inspectRewardRun, releaseRewardRun, UncertainRewardSubmission } from "@/lib/tiered-rewards/run-guard";

const key = Keypair.random();
function transaction(networkPassphrase = Networks.PUBLIC) {
  const tx = new TransactionBuilder(new Account(key.publicKey(), "1"), { fee: "100", networkPassphrase })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" })).setTimeout(30).build();
  tx.sign(key);
  return tx;
}
function server(submit: ReturnType<typeof vi.fn>, lookup: ReturnType<typeof vi.fn>) {
  return { submitTransaction: submit, transactions: () => ({ transaction: () => ({ call: lookup }) }) } as unknown as Horizon.Server;
}
beforeEach(() => { storage.row = null; storage.failUpdate = false; });

it("keeps a durable Supabase guard when Horizon outcome is unknown", async () => {
  const guard = await claimRewardRun("config");
  const tx = transaction();
  await expect(guard.submit(server(vi.fn().mockRejectedValue(new Error("lost")), vi.fn().mockRejectedValue(new Error("missing"))), tx)).rejects.toBeInstanceOf(UncertainRewardSubmission);
  expect(await guard.complete(true)).toBe(true);
  expect(JSON.parse(storage.row!.lease_token).transactions[0]).toMatchObject({ hash: tx.hash().toString("hex"), xdr: tx.toXDR(), status: "prepared" });
  await expect(claimRewardRun("config")).rejects.toThrow("reconciliation");
});

it("reconciles a confirmed payment and clears its Supabase guard only at successful completion", async () => {
  const guard = await claimRewardRun("config");
  const tx = transaction();
  await expect(guard.submit(server(vi.fn().mockRejectedValue(new Error("lost")), vi.fn().mockResolvedValue({ successful: true })), tx)).resolves.toEqual({ hash: tx.hash().toString("hex") });
  expect(JSON.parse(storage.row!.lease_token).transactions[0].status).toBe("sent");
  expect(await guard.complete(false)).toBe(false);
  expect(storage.row).toBeNull();
});

it("treats tx_bad_seq without ledger evidence as unresolved", async () => {
  const guard = await claimRewardRun("config");
  const error = { response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } };
  await expect(guard.submit(server(vi.fn().mockRejectedValue(error), vi.fn().mockRejectedValue(new Error("lagging"))), transaction()))
    .rejects.toBeInstanceOf(UncertainRewardSubmission);
  expect(JSON.parse(storage.row!.lease_token).transactions[0].status).toBe("prepared");
});

it("fails closed before broadcasting when Supabase cannot journal the transaction", async () => {
  const guard = await claimRewardRun("config");
  storage.failUpdate = true;
  const submit = vi.fn();
  await expect(guard.submit(server(submit, vi.fn()), transaction())).rejects.toThrow("protection");
  expect(submit).not.toHaveBeenCalled();
});

it("does not release an uncertain payment without a definitive ledger result", async () => {
  const guard = await claimRewardRun("config");
  const tx = transaction();
  await expect(guard.submit(server(vi.fn().mockRejectedValue(new Error("lost")), vi.fn().mockRejectedValue(new Error("missing"))), tx))
    .rejects.toBeInstanceOf(UncertainRewardSubmission);
  const missing = await inspectRewardRun("config", server(vi.fn(), vi.fn().mockRejectedValue(new Error("not found"))), Networks.PUBLIC);
  expect(missing).toMatchObject({ ready: false, transactions: [{ hash: tx.hash().toString("hex"), successful: null }] });
  expect(storage.row).not.toBeNull();
  const confirmed = await inspectRewardRun("config", server(vi.fn(), vi.fn().mockResolvedValue({ successful: true })), Networks.PUBLIC);
  expect(confirmed?.ready).toBe(true);
  await releaseRewardRun("config", confirmed!.raw);
  expect(storage.row).toBeNull();
});

it("refuses to clear a guard changed after inspection", async () => {
  const guard = await claimRewardRun("config");
  await expect(guard.submit(server(vi.fn().mockRejectedValue(new Error("lost")), vi.fn().mockRejectedValue(new Error("missing"))), transaction()))
    .rejects.toBeInstanceOf(UncertainRewardSubmission);
  const inspected = await inspectRewardRun("config", server(vi.fn(), vi.fn().mockResolvedValue({ successful: false })), Networks.PUBLIC);
  expect(inspected?.ready).toBe(true);
  storage.row!.lease_token += " ";
  await expect(releaseRewardRun("config", inspected!.raw)).rejects.toThrow("changed");
  expect(storage.row).not.toBeNull();
});

it("validates a testnet journal against the matching passphrase", async () => {
  const guard = await claimRewardRun("config");
  const tx = transaction(Networks.TESTNET);
  await expect(guard.submit(server(vi.fn().mockRejectedValue(new Error("lost")), vi.fn().mockRejectedValue(new Error("missing"))), tx))
    .rejects.toBeInstanceOf(UncertainRewardSubmission);
  await expect(inspectRewardRun("config", server(vi.fn(), vi.fn().mockResolvedValue({ successful: true })), Networks.PUBLIC))
    .rejects.toThrow("incomplete");
  expect((await inspectRewardRun("config", server(vi.fn(), vi.fn().mockResolvedValue({ successful: true })), Networks.TESTNET))?.ready).toBe(true);
});

it("can release an empty claim left by a crash before the first transaction", async () => {
  const guard = await claimRewardRun("config");
  const inspected = await inspectRewardRun("config", server(vi.fn(), vi.fn()), Networks.PUBLIC);
  expect(inspected).toMatchObject({ ready: true, transactions: [] });
  await releaseRewardRun("config", inspected!.raw);
  const submit = vi.fn();
  await expect(guard.submit(server(submit, vi.fn()), transaction())).rejects.toThrow("protection");
  expect(submit).not.toHaveBeenCalled();
});
