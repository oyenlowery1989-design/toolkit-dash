import { describe, it, expect } from "vitest";
import { resolveAddress } from "@/lib/address-resolver";
import type { AddressBookEntry } from "@/hooks/use-address-book";
import type { KnownIntermediary, KnownCreator } from "@/lib/intermediary-tracer/types";
import type { AssetGroup, GroupMember } from "@/lib/asset-groups/types";

const ADDR_A = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";
const ADDR_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeBookEntry(address: string, label: string): AddressBookEntry {
  return { publicKey: address, label, timestamp: 1000 };
}

function makeIntermediary(address: string, name: string): KnownIntermediary {
  return { address, name, addedAt: 1000 };
}

function makeCreator(address: string, name: string): KnownCreator {
  return { address, name, addedAt: 1000 };
}

function makeGroup(address: string, role: GroupMember["role"], label?: string): AssetGroup {
  const member: GroupMember = {
    id: "m1",
    groupId: "g1",
    address,
    role,
    label,
    addedAt: 1000,
  };
  return {
    id: "g1",
    name: "Test Group",
    network: "mainnet",
    createdAt: 1000,
    updatedAt: 1000,
    members: [member],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveAddress", () => {
  it('returns source: "none" when address is not in any source', () => {
    const result = resolveAddress(ADDR_A, [], [], [], []);
    expect(result.source).toBe("none");
    expect(result.name).toBeUndefined();
    expect(result.badge).toBeUndefined();
  });

  it('returns source: "book" with correct name when only address book matches', () => {
    const book = [makeBookEntry(ADDR_A, "My Friend")];
    const result = resolveAddress(ADDR_A, book, [], [], []);
    expect(result.source).toBe("book");
    expect(result.name).toBe("My Friend");
    expect(result.badge).toBeUndefined();
  });

  it('returns source: "group" with badge = role uppercased and purple badgeClass', () => {
    const book = [makeBookEntry(ADDR_A, "Book Label")];
    const groups = [makeGroup(ADDR_A, "issuer", "My Issuer")];
    const result = resolveAddress(ADDR_A, book, [], [], groups);
    expect(result.source).toBe("group");
    expect(result.badge).toBe("ISSUER");
    expect(result.badgeClass).toContain("purple");
    expect(result.name).toBe("My Issuer");
  });

  it("falls back to group name when group member has no label", () => {
    const groups = [makeGroup(ADDR_A, "bank", undefined)];
    const result = resolveAddress(ADDR_A, [], [], [], groups);
    expect(result.source).toBe("group");
    expect(result.name).toBe("Test Group");
  });

  it('returns source: "creator" with badge "CREATOR" and green badgeClass', () => {
    const book = [makeBookEntry(ADDR_A, "Book Label")];
    const groups = [makeGroup(ADDR_A, "issuer", "Group Label")];
    const creators = [makeCreator(ADDR_A, "Real Creator")];
    const result = resolveAddress(ADDR_A, book, [], creators, groups);
    expect(result.source).toBe("creator");
    expect(result.badge).toBe("CREATOR");
    expect(result.badgeClass).toContain("green");
    expect(result.name).toBe("Real Creator");
  });

  it('returns source: "intermediary" with badge "INTERMEDIARY" and yellow badgeClass', () => {
    const book = [makeBookEntry(ADDR_A, "Book Label")];
    const groups = [makeGroup(ADDR_A, "issuer", "Group Label")];
    const creators = [makeCreator(ADDR_A, "Real Creator")];
    const intermediaries = [makeIntermediary(ADDR_A, "Known Exchange")];
    const result = resolveAddress(ADDR_A, book, intermediaries, creators, groups);
    expect(result.source).toBe("intermediary");
    expect(result.badge).toBe("INTERMEDIARY");
    expect(result.badgeClass).toContain("yellow");
    expect(result.name).toBe("Known Exchange");
  });

  it("priority: intermediary > creator > group > book", () => {
    // ADDR_A in all four sources
    const book = [makeBookEntry(ADDR_A, "Book")];
    const groups = [makeGroup(ADDR_A, "distributor", "GroupMember")];
    const creators = [makeCreator(ADDR_A, "Creator")];
    const intermediaries = [makeIntermediary(ADDR_A, "Intermediary")];

    // intermediary beats all
    expect(resolveAddress(ADDR_A, book, intermediaries, creators, groups).source).toBe("intermediary");

    // without intermediary, creator wins
    expect(resolveAddress(ADDR_A, book, [], creators, groups).source).toBe("creator");

    // without intermediary or creator, group wins
    expect(resolveAddress(ADDR_A, book, [], [], groups).source).toBe("group");

    // only book
    expect(resolveAddress(ADDR_A, book, [], [], []).source).toBe("book");
  });

  it("does not match a different address", () => {
    const book = [makeBookEntry(ADDR_B, "Other Person")];
    const result = resolveAddress(ADDR_A, book, [], [], []);
    expect(result.source).toBe("none");
  });
});
