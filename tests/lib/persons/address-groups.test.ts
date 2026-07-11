import { describe, it, expect } from "vitest";
import { groupsForAddress } from "@/lib/persons/address-groups";
import type { AssetGroup, GroupMember } from "@/lib/asset-groups/types";

const ADDR_A = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";
const ADDR_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function makeMember(address: string, role: GroupMember["role"] = "other"): GroupMember {
  return { id: `m-${address}`, groupId: "g", address, role, addedAt: 1000 };
}

function makeGroup(id: string, members: GroupMember[]): AssetGroup {
  return { id, name: `Group ${id}`, network: "public", members, createdAt: 1000, updatedAt: 1000 };
}

describe("groupsForAddress", () => {
  it("returns an empty array when there are no groups", () => {
    expect(groupsForAddress(ADDR_A, [])).toEqual([]);
  });

  it("returns an empty array when the address is in no group", () => {
    const groups = [makeGroup("g1", [makeMember(ADDR_B)])];
    expect(groupsForAddress(ADDR_A, groups)).toEqual([]);
  });

  it("returns the group when the address is a member, regardless of role", () => {
    const groups = [makeGroup("g1", [makeMember(ADDR_A, "bank")])];
    expect(groupsForAddress(ADDR_A, groups)).toEqual(groups);
  });

  it("returns every group the address belongs to", () => {
    const g1 = makeGroup("g1", [makeMember(ADDR_A, "issuer")]);
    const g2 = makeGroup("g2", [makeMember(ADDR_B)]);
    const g3 = makeGroup("g3", [makeMember(ADDR_A, "distributor")]);
    expect(groupsForAddress(ADDR_A, [g1, g2, g3])).toEqual([g1, g3]);
  });
});
