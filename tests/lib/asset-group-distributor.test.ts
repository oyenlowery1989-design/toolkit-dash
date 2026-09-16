import { describe, expect, it } from "vitest";
import { findSavedDistributor, type AssetGroup } from "@/lib/asset-groups/types";

const group: AssetGroup = {
  id: "group-1",
  name: "USDC Asset",
  assetCode: "USDC",
  issuer: "GISSUER",
  network: "public",
  createdAt: 0,
  updatedAt: 0,
  members: [
    { id: "issuer", groupId: "group-1", address: "GISSUER", role: "issuer", addedAt: 0 },
    { id: "distrib", groupId: "group-1", address: "GDISTRIB", role: "distributor", addedAt: 0 },
  ],
};

describe("findSavedDistributor", () => {
  it("finds the distributor for the exact asset identity", () => {
    expect(findSavedDistributor([group], "usdc", "GISSUER", "public")).toBe("GDISTRIB");
  });

  it("does not reuse a distributor from a different network", () => {
    expect(findSavedDistributor([group], "USDC", "GISSUER", "testnet")).toBeUndefined();
  });
});
