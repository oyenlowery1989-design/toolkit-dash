// tests/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { shortAddr, formatXlm, parseAddresses } from "@/lib/format";

// Real valid Ed25519 Stellar public keys (verified via StrKey.isValidEd25519PublicKey)
const VALID_ADDR = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";
const VALID_ADDR2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("shortAddr", () => {
  it("returns 4+…+4 format", () => {
    // GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ
    // first 4: GAMM, last 4: VCNJ
    expect(shortAddr(VALID_ADDR)).toBe("GAMM…VCNJ");
  });

  it("returns short strings unchanged", () => {
    expect(shortAddr("GABC")).toBe("GABC");
    expect(shortAddr("")).toBe("");
  });

  it("handles exactly 8 chars", () => {
    expect(shortAddr("ABCDEFGH")).toBe("ABCD…EFGH");
  });
});

describe("formatXlm", () => {
  it("formats whole numbers — contains the digits", () => {
    const result = formatXlm(1000);
    // toLocaleString may insert commas or dots as thousand separators depending on locale,
    // so just check that the significant digits are present and no fractional part
    expect(result).toMatch(/1.?000$/);
  });

  it("formats fractional values and trims trailing zeros", () => {
    const result = formatXlm(0.5);
    // Should contain "5" and not have additional trailing zeros beyond 1 decimal
    expect(result).toContain("5");
    // Should not end in 50, 500, etc. (trailing zeros trimmed)
    expect(result).not.toMatch(/50+$/);
  });

  it("handles zero", () => {
    expect(formatXlm(0)).toBe("0");
  });

  it("respects up to 7 decimal places", () => {
    const result = formatXlm(0.0000001);
    expect(result).toContain("1");
  });

  it("trims trailing zeros on fractional values", () => {
    // 1.5000000 should not end with trailing zeros
    const result = formatXlm(1.5);
    expect(result).not.toMatch(/0+$/);
  });
});

describe("parseAddresses", () => {
  it("returns valid addresses from multiline string", () => {
    const input = `${VALID_ADDR}\n${VALID_ADDR2}`;
    const result = parseAddresses(input);
    expect(result).toEqual([VALID_ADDR, VALID_ADDR2]);
  });

  it("deduplicates addresses", () => {
    const input = `${VALID_ADDR}\n${VALID_ADDR}`;
    expect(parseAddresses(input)).toHaveLength(1);
  });

  it("filters out invalid lines", () => {
    const input = `not-an-address\n${VALID_ADDR}\n  `;
    const result = parseAddresses(input);
    expect(result).toEqual([VALID_ADDR]);
  });

  it("trims whitespace from lines", () => {
    const input = `  ${VALID_ADDR}  `;
    expect(parseAddresses(input)).toEqual([VALID_ADDR]);
  });

  it("returns empty array for empty input", () => {
    expect(parseAddresses("")).toEqual([]);
    expect(parseAddresses("   \n\n  ")).toEqual([]);
  });
});
