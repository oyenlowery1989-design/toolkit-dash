import { describe, expect, it, vi } from "vitest";
import { saveAssetGroup } from "@/components/shared/proceeds/SaveToGroupButton";

describe("saveAssetGroup", () => {
  it("creates the asset group and adds the supplied addresses without navigating", () => {
    const createGroup = vi.fn(() => "group-1");
    const upsertMember = vi.fn();

    const id = saveAssetGroup(
      {
        assetCode: "USDC",
        issuer: "GISSUER",
        network: "public",
        distribAddress: "GDISTRIB",
        bankAddress: "GBANK",
      },
      { createGroup, upsertMember },
    );

    expect(id).toBe("group-1");

    expect(createGroup).toHaveBeenCalledWith({
      name: "USDC Asset",
      assetCode: "USDC",
      issuer: "GISSUER",
      network: "public",
    });
    expect(upsertMember).toHaveBeenCalledWith("group-1", {
      address: "GISSUER",
      role: "issuer",
      label: "Issuer USDC",
      homeDomain: undefined,
    });
    expect(upsertMember).toHaveBeenCalledWith("group-1", {
      address: "GDISTRIB",
      role: "distributor",
      label: "Distrib USDC",
      homeDomain: undefined,
    });
    expect(upsertMember).toHaveBeenCalledWith("group-1", {
      address: "GBANK",
      role: "bank",
      label: "Bank USDC",
      homeDomain: undefined,
    });
  });
});
