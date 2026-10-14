import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "stellar-sdk";

const { supabaseOnly, run, getDb } = vi.hoisted(() => ({
  supabaseOnly: vi.fn(() => true),
  run: vi.fn(),
  getDb: vi.fn(() => ({ prepare: () => ({ get: () => undefined, run }) })),
}));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: vi.fn(async () => ({ ok: true, userId: "user" })),
  isSupabaseOnly: supabaseOnly,
}));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/key-scanner/loop", () => ({
  startKeyScanLoopRun: vi.fn(), stopKeyScanLoopRun: vi.fn(),
  updateKeyScanConfig: vi.fn(), getKeyScanState: vi.fn(),
}));

import { POST as watchPost, PATCH as watchPatch, DELETE as watchDelete } from "@/app/api/db/tracer-watchlist/route";
import { POST as scannerControl } from "@/app/api/keyscan/control/route";

const request = (path: string, method: string, body: object) => new NextRequest(`http://localhost${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => { vi.clearAllMocks(); supabaseOnly.mockReturnValue(true); });

it("rejects watchlist writes and scanner start when local persistence is unavailable", async () => {
  const address = Keypair.random().publicKey();
  expect((await watchPost(request("/api/db/tracer-watchlist", "POST", { address }))).status).toBe(503);
  expect((await watchPatch(request("/api/db/tracer-watchlist", "PATCH", { id: "watch", enabled: true }))).status).toBe(503);
  expect((await watchDelete(request("/api/db/tracer-watchlist", "DELETE", { key: "watch" }))).status).toBe(503);
  expect((await scannerControl(request("/api/keyscan/control", "POST", { action: "start" }))).status).toBe(400);
  expect(getDb).not.toHaveBeenCalled();
});

it("rejects invalid watch addresses before writing to SQLite", async () => {
  supabaseOnly.mockReturnValue(false);
  const response = await watchPost(request("/api/db/tracer-watchlist", "POST", { address: "bad" }));
  expect(response.status).toBe(400);
  expect(run).not.toHaveBeenCalled();
});
