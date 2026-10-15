import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetGroup } from "@/lib/asset-groups/types";
import { selectSellerAccounts } from "@/lib/proceeds-investigator/selection";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
vi.mock("@/lib/asset-lookup/fetchers", () => ({ inferDistribLite: vi.fn() }));
const group = (assetCode = "WhipSim", issuer = "issuer", network = "public"): AssetGroup => ({
  id: "g", name: "saved", assetCode, issuer, network, createdAt: 1, updatedAt: 1,
  members: ["seller-a", "seller-b", "seller-a"].map((address, i) => ({ id: String(i), groupId: "g", address, role: "distributor", addedAt: 1 })),
});
const options = () => ({ horizonUrl: "https://horizon.test", assetCode: "WhipSim", issuer: "issuer", network: "public", groups: [], signal: new AbortController().signal });
afterEach(() => vi.clearAllMocks());
describe("seller selection", () => {
  it("uses an asset-specific saved read while the global groups cache is pending", async () => {
    const result = await selectSellerAccounts({ ...options(), savedAccounts: ["seller-a", "seller-b"] });
    expect(result.accounts).toEqual(["seller-a", "seller-b"]);
    expect(result.attributions.every(a => a.source === "saved")).toBe(true);
    expect(inferDistribLite).not.toHaveBeenCalled();
  });
  it("preserves a deduplicated manual override without inference", async () => {
    const result = await selectSellerAccounts({ ...options(), groups: [group()], manualAccounts: ["manual", " manual "] });
    expect(result.accounts).toEqual(["manual"]);
    expect(result.attributions[0].source).toBe("manual");
    expect(inferDistribLite).not.toHaveBeenCalled();
  });
  it("uses every saved distributor and does not infer", async () => {
    const result = await selectSellerAccounts({ ...options(), groups: [group()] });
    expect(result.accounts).toEqual(["seller-a", "seller-b"]);
    expect(result.attributions.every(a => a.source === "saved")).toBe(true);
    expect(inferDistribLite).not.toHaveBeenCalled();
  });
  it("keeps issuer, network and case-distinct ledger identities separate", async () => {
    vi.mocked(inferDistribLite).mockResolvedValue([]);
    const result = await selectSellerAccounts({ ...options(), groups: [group("WHIPSIM"), group("WhipSim", "other"), group("WhipSim", "issuer", "testnet")] });
    expect(result.accounts).toEqual([]);
    expect(inferDistribLite).toHaveBeenCalledOnce();
  });
  it("keeps multiple proved receipt candidates and their evidence", async () => {
    const evidence = [{ kind: "claimable_balance" as const, from: "relay", to: "seller-a", amount: "10", operationId: "creation", claimOperationId: "claim", balanceId: "balance" }];
    vi.mocked(inferDistribLite).mockResolvedValue([{ address: "seller-a", score: 2, reason: "claimed", evidence }, { address: "seller-b", score: 1, reason: "funded", evidence: [] }]);
    const onResult = vi.fn();
    const result = await selectSellerAccounts({ ...options(), onResult });
    expect(result.accounts).toEqual(["seller-a", "seller-b"]);
    expect(result.attributions[0].evidence).toEqual(evidence);
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});
