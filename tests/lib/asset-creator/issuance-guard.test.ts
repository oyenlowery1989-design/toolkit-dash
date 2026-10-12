import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), isSupabaseOnly: vi.fn(() => false) }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: mocks.isSupabaseOnly, getSupabase: vi.fn() }));
import { claimAssetIssuance, readAssetIssuanceClaim } from "@/lib/asset-creator/issuance-guard";

const claim = (assetCode = "myTOKEN", unsignedXdr = "unsigned-1") => ({
  network: "public", issuer: "GISSUER", asset_code: assetCode,
  unsigned_xdr: unsignedXdr, unsigned_hash: unsignedXdr,
  signed_xdr: `signed-${unsignedXdr}`, created_at: Date.now(),
});

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE asset_creator_issuance_claims (
    network TEXT NOT NULL, issuer TEXT NOT NULL, asset_code TEXT NOT NULL,
    unsigned_xdr TEXT NOT NULL, unsigned_hash TEXT NOT NULL,
    signed_xdr TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (network, issuer, asset_code))`);
  mocks.getDb.mockReturnValue(db);
});

describe("Asset Creator issuance claim", () => {
  it("stores one signed transaction and replays it for the same unsigned XDR", async () => {
    expect(await claimAssetIssuance(claim())).toBe("signed-unsigned-1");
    expect(await claimAssetIssuance({ ...claim(), signed_xdr: "different-signature" })).toBe("signed-unsigned-1");
    expect(await readAssetIssuanceClaim("public", "GISSUER", "myTOKEN")).toBe("signed-unsigned-1");
    expect(db.prepare("SELECT COUNT(*) AS count FROM asset_creator_issuance_claims").get()).toEqual({ count: 1 });
  });
  it("returns the original signed XDR for a changed issuance and preserves asset code case", async () => {
    await claimAssetIssuance(claim());
    expect(await claimAssetIssuance(claim("myTOKEN", "unsigned-2"))).toBe("signed-unsigned-1");
    expect(await claimAssetIssuance(claim("MYTOKEN", "unsigned-2"))).toBe("signed-unsigned-2");
    expect(await readAssetIssuanceClaim("testnet", "GISSUER", "myTOKEN")).toBeNull();
  });
});
