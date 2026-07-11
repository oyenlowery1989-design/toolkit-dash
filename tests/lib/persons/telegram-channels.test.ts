import { describe, it, expect } from "vitest";
import { telegramChannelsForPerson } from "@/lib/persons/telegram-channels";
import type { AssetGroup, GroupMember } from "@/lib/asset-groups/types";
import type { Person } from "@/lib/persons/types";

const ADDR_A = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";

function makeMember(address: string): GroupMember {
  return { id: `m-${address}`, groupId: "g", address, role: "other", addedAt: 1000 };
}

function makeGroup(id: string, opts: Partial<AssetGroup> = {}): AssetGroup {
  return { id, name: `Group ${id}`, network: "public", members: [], createdAt: 1000, updatedAt: 1000, ...opts };
}

function makePerson(opts: Partial<Person> = {}): Person {
  return {
    id: "p1",
    name: "Alice",
    addresses: [],
    relationships: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...opts,
  };
}

describe("telegramChannelsForPerson", () => {
  it("returns an empty array when the person has no related groups", () => {
    expect(telegramChannelsForPerson(makePerson(), [])).toEqual([]);
  });

  it("includes the channel of a group attributed to the person", () => {
    const person = makePerson();
    const groups = [makeGroup("g1", { personId: "p1", telegramChannel: "MyChannel" })];
    expect(telegramChannelsForPerson(person, groups)).toEqual([{ key: "mychannel", raw: "MyChannel" }]);
  });

  it("includes the channel of a group one of the person's addresses belongs to", () => {
    const person = makePerson({ addresses: [{ id: "a1", personId: "p1", address: ADDR_A, addedAt: 1000 }] });
    const groups = [makeGroup("g1", { members: [makeMember(ADDR_A)], telegramChannel: "BankChan" })];
    expect(telegramChannelsForPerson(person, groups)).toEqual([{ key: "bankchan", raw: "BankChan" }]);
  });

  it("dedupes the same channel across both sources, keeping the first-seen raw casing", () => {
    const person = makePerson({ addresses: [{ id: "a1", personId: "p1", address: ADDR_A, addedAt: 1000 }] });
    const groups = [
      makeGroup("g1", { personId: "p1", telegramChannel: "@Chan" }),
      makeGroup("g2", { members: [makeMember(ADDR_A)], telegramChannel: "chan" }),
    ];
    expect(telegramChannelsForPerson(person, groups)).toEqual([{ key: "chan", raw: "@Chan" }]);
  });

  it("skips groups with no telegramChannel set", () => {
    const person = makePerson();
    const groups = [makeGroup("g1", { personId: "p1" })];
    expect(telegramChannelsForPerson(person, groups)).toEqual([]);
  });

  it("carries the group's explicit telegramLink alongside the derived channel", () => {
    const person = makePerson();
    const groups = [
      makeGroup("g1", { personId: "p1", telegramChannel: "chan", telegramLink: "https://t.me/joinchat/xyz" }),
    ];
    expect(telegramChannelsForPerson(person, groups)).toEqual([
      { key: "chan", raw: "chan", link: "https://t.me/joinchat/xyz" },
    ]);
  });
});
