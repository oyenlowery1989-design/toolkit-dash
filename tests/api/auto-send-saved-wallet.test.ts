import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "stellar-sdk";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), run: vi.fn(), get: vi.fn(), supabaseOnly: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth, isSupabaseOnly: mocks.supabaseOnly, getSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: () => ({ run: mocks.run, get: mocks.get }) }) }));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.load }));
vi.mock("@/lib/secret-storage", () => ({ encryptStoredSecret: (key: string) => `encrypted:${key}`, decryptStoredSecret: (key: string) => key.replace(/^encrypted:/, "") }));
import { POST, PATCH } from "@/app/api/db/auto-send-groups/route";

const signer = Keypair.random();
function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/db/auto-send-groups", { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.load.mockResolvedValue(signer);
  mocks.run.mockReset();
  mocks.get.mockReset();
  mocks.supabaseOnly.mockReturnValue(false);
  mocks.from.mockReset();
});

describe("auto-send saved wallet setup", () => {
  it("copies a saved signing key directly into encrypted group storage", async () => {
    const response = await POST(request("POST", { type: "group", id: "group", name: "Payouts", network: "public", walletId: "wallet" }));
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith("wallet", "owner");
    expect(mocks.run.mock.calls[0][3]).toBe(`encrypted:${signer.secret()}`);
    expect(JSON.stringify(await response.json())).not.toContain(signer.secret());
  });

  it("allows replacing a group key from a saved wallet without browser secret", async () => {
    const response = await PATCH(request("PATCH", { type: "group", id: "group", walletId: "wallet" }));
    expect(response.status).toBe(200);
    expect(mocks.run.mock.calls[0][0]).toBe(`encrypted:${signer.secret()}`);
  });

  it("rejects a missing wallet and mixed key sources", async () => {
    mocks.load.mockResolvedValueOnce(null);
    expect((await POST(request("POST", { type: "group", id: "group", name: "Payouts", walletId: "missing" }))).status).toBe(404);
    expect((await PATCH(request("PATCH", { type: "group", id: "group", walletId: "wallet", secretKey: "S..." }))).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects watch-only wallets before storing a group", async () => {
    mocks.load.mockRejectedValueOnce(new Error("This wallet is watch-only; no signing key is saved"));
    const response = await POST(request("POST", { type: "group", id: "group", name: "Payouts", walletId: "watch" }));
    expect(response.status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("duplicates the masked group key on the server", async () => {
    mocks.get.mockReturnValue({ secret_key: `encrypted:${signer.secret()}` });
    const response = await POST(request("POST", { type: "group", id: "copy", name: "Copy", copyFromGroupId: "group", secretKey: "", enabled: false }));
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("group");
    expect(mocks.run.mock.calls[0][3]).toBe(`encrypted:${signer.secret()}`);
    expect(JSON.stringify(await response.json())).not.toContain(signer.secret());
  });

  it("limits a cloud group copy to the authenticated owner", async () => {
    mocks.supabaseOnly.mockReturnValue(true);
    const chain = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), upsert: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.from.mockReturnValue(chain);
    const response = await POST(request("POST", { type: "group", id: "copy", name: "Copy", copyFromGroupId: "someone-elses-group", secretKey: "" }));
    expect(response.status).toBe(404);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(chain.upsert).not.toHaveBeenCalled();
  });
});
