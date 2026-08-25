import { describe, expect, it } from "vitest";
import {
  defaultGroupMemberLabel,
  resolveGroupMemberLabel,
} from "@/lib/asset-groups/types";

describe("defaultGroupMemberLabel", () => {
  it("adds the asset code to asset-specific roles", () => {
    expect(defaultGroupMemberLabel("issuer", "JFKBANK2")).toBe("Issuer JFKBANK2");
    expect(defaultGroupMemberLabel("distributor", "JFKBANK2")).toBe("Distrib JFKBANK2");
    expect(defaultGroupMemberLabel("bank", "JFKBANK2")).toBe("Bank JFKBANK2");
  });

  it("preserves the asset code's original case", () => {
    expect(defaultGroupMemberLabel("bank", "wUSDC")).toBe("Bank wUSDC");
  });

  it("does not invent labels for global roles or groups without an asset", () => {
    expect(defaultGroupMemberLabel("intermediary", "JFKBANK2")).toBeUndefined();
    expect(defaultGroupMemberLabel("bank")).toBeUndefined();
  });

  it("upgrades only legacy generic defaults to asset-specific labels", () => {
    expect(resolveGroupMemberLabel("bank", "Bank", "GYACHT")).toBe("Bank GYACHT");
    expect(resolveGroupMemberLabel("distributor", "Distributor", "GYACHT")).toBe("Distrib GYACHT");
    expect(resolveGroupMemberLabel("issuer", "Issuer treasury", "GYACHT")).toBe("Issuer treasury");
  });
});
