import { describe, it, expect } from "vitest";
import { generateTomlSnippet } from "../../../lib/asset-creator/toml";
import type { AssetCreatorForm } from "../../../lib/asset-creator/types";

const base: AssetCreatorForm = {
  network: "public",
  issuerPublicKey: "GABCDE12345678901234567890123456789012345678901234567890",
  issuerSecretKey: "",
  distributorPublicKey: "GXYZ",
  distributorSecretKey: "",
  resolvedFundingSecretKey: "",
  assetCode: "myTOKEN",
  tokenName: "My Token",
  supply: 1_000_000,
  memo: "",
  homeDomain: "example.com",
};

describe("generateTomlSnippet", () => {
  it("preserves asset code case exactly", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain('code = "myTOKEN"');
    expect(snippet).not.toContain('code = "MYTOKEN"');
  });

  it("uses full issuer public key (not truncated)", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain(`issuer = "${base.issuerPublicKey}"`);
  });

  it("hardcodes display_decimals = 7", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain("display_decimals = 7");
  });

  it("includes token name when provided", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain('name = "My Token"');
  });

  it("omits name line when tokenName is empty string", () => {
    const snippet = generateTomlSnippet({ ...base, tokenName: "" });
    expect(snippet).not.toContain("name =");
  });

  it("includes all required TOML fields", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain("[[CURRENCIES]]");
    expect(snippet).toContain("is_asset_anchored =");
    expect(snippet).toContain("anchor_asset_type =");
  });
});
