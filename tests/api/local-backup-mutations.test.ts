import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { Keypair } from "stellar-sdk";
import type { BackupOperation } from "@/lib/local-backup-queue";

vi.mock("@/lib/supabase-server", async () => {
  const { enqueueLocalBackup } = await import("@/lib/local-backup-queue");
  return {
    requireAuth: async () => ({ ok: true, userId: "owner" }),
    isSupabaseOnly: () => false,
    getSupabase: () => { throw new Error("Local mutations must enqueue, not contact the cloud"); },
    syncToSupabase: (operations: BackupOperation | BackupOperation[]) => enqueueLocalBackup(operations, "owner"),
  };
});
let dir: string | undefined;
afterEach(() => {
  globalThis._stellarDb?.close(); globalThis._stellarDb = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined; vi.unstubAllEnvs(); vi.resetModules();
});
function req(body: unknown) { return new NextRequest("http://localhost/api/db/test", { method: "POST", body: JSON.stringify(body) }); }
async function setup() {
  dir = mkdtempSync(path.join(tmpdir(), "stellar-local-mutations-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(dir, "test.db"));
  return (await import("@/lib/db")).getDb();
}

it("all basic local mutation routes commit their backup jobs with SQLite", async () => {
  const db = await setup();
  const address = Keypair.random().publicKey();
  const book = await import("@/app/api/db/address-book/route");
  const state = await import("@/app/api/db/app-state/route");
  const recipients = await import("@/app/api/db/bulk-recipients/route");
  const runs = await import("@/app/api/db/bulk-runs/route");
  const scans = await import("@/app/api/db/bulk-scan-state/route");
  const creators = await import("@/app/api/db/known-creators/route");
  const intermediaries = await import("@/app/api/db/known-intermediaries/route");
  const folders = await import("@/app/api/db/wallet-folders/route");
  const wallets = await import("@/app/api/db/wallets-v2/route");
  const calls = [
    () => book.POST(req({ publicKey: address, label: "Address" })), () => book.DELETE(req({ key: address })),
    () => state.POST(req({ key: "sample", value: "value" })), () => state.POST(req({ key: "sample", value: "" })),
    () => recipients.POST(req({ id: "list", name: "List", network: "public", addresses: [address] })), () => recipients.DELETE(req({ key: "list" })),
    () => runs.POST(req({ id: "run", network: "public", memo: "", recipientCount: 1, successCount: 1, failedCount: 0 })),
    () => scans.POST(req({ rowsJson: "[]" })), () => scans.DELETE(req({})),
    () => creators.POST(req({ address, name: "Creator" })), () => creators.DELETE(req({ key: address })),
    () => intermediaries.POST(req({ address, name: "Intermediary" })), () => intermediaries.DELETE(req({ key: address })),
    () => folders.POST(req({ id: "folder", name: "Folder" })), () => folders.PATCH(req({ id: "folder", name: "Renamed" })),
    () => wallets.POST(req({ id: "wallet", folderId: "folder", name: "Wallet", publicKey: address, secretKey: "" })),
    () => wallets.PATCH(req({ id: "wallet", name: "Renamed wallet" })),
    () => wallets.PATCH(req({ id: "wallet", folderId: "folder" })), () => wallets.DELETE(req({ key: "wallet" })),
    () => folders.DELETE(req({ key: "folder" })),
  ];
  for (const call of calls) expect((await call()).status).toBe(200);
  expect(db.prepare("SELECT count(*) AS count FROM local_backup_queue").get()).toEqual({ count: calls.length });
});

it("search deletion captures natural keys instead of unrelated cloud numeric IDs", async () => {
  const db = await setup();
  const searches = await import("@/app/api/db/saved-searches/route");
  expect((await searches.POST(req({ type: "asset", value: "wUSDC:GISSUER" }))).status).toBe(200);
  const row = db.prepare("SELECT id FROM saved_searches").get() as { id: number };
  expect((await searches.DELETE(req({ id: row.id }))).status).toBe(200);
  const jobs = db.prepare("SELECT operations_json FROM local_backup_queue ORDER BY id").all() as { operations_json: string }[];
  expect(JSON.parse(jobs[1].operations_json)[0].match).toEqual({ type: "asset", value: "wUSDC:GISSUER", user_id: "owner" });
});

it("repeated creator-child saves queue the retained local ID and enriched fields", async () => {
  const db = await setup();
  const children = await import("@/app/api/db/creator-children/route");
  const entry = { id: "original", creatorAddress: "GCREATOR", childAddress: "GCHILD", network: "public", discoveredAt: 1, homeDomain: "example.com" };
  expect((await children.POST(req(entry))).status).toBe(200);
  expect((await children.POST(req({ ...entry, id: "new-id", homeDomain: undefined }))).status).toBe(200);
  const jobs = db.prepare("SELECT operations_json FROM local_backup_queue ORDER BY id").all() as { operations_json: string }[];
  const job = JSON.parse(jobs[1].operations_json)[0];
  expect(job).toMatchObject({ onConflict: "user_id,creator_address,child_address,network", preserveExisting: ["id", "discovered_at"] });
  expect(job.data[0]).toMatchObject({ id: "original", home_domain: "example.com" });
  expect((await children.DELETE(req({ id: "original" }))).status).toBe(200);
  const last = db.prepare("SELECT operations_json FROM local_backup_queue ORDER BY id DESC LIMIT 1").get() as { operations_json: string };
  expect(JSON.parse(last.operations_json)[0].match).toEqual({ creator_address: "GCREATOR", child_address: "GCHILD", network: "public", user_id: "owner" });
});
