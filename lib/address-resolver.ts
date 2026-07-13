/**
 * Pure address resolution — merges Persons, Address Book, Known Intermediaries,
 * Known Creators, and Asset Group members into one lookup result.
 *
 * Call with data from the five hooks. ShortAddress subscribes to all five.
 */

import type { AddressBookEntry } from "@/hooks/use-address-book";
import type { KnownIntermediary } from "@/lib/intermediary-tracer/types";
import type { KnownCreator } from "@/lib/intermediary-tracer/types";
import type { AssetGroup } from "@/lib/asset-groups/types";
import type { Person } from "@/lib/persons/types";

export type AddressSourceType =
  | "book"
  | "intermediary"
  | "creator"
  | "group"
  | "person"
  | "none";

export interface ResolvedAddress {
  /** Best display name, or undefined */
  name?: string;
  source: AddressSourceType;
  /** Badge label, e.g. "INTERMEDIARY" */
  badge?: string;
  /** Tailwind classes for the badge */
  badgeClass?: string;
}

const BADGE: Record<string, string> = {
  INTERMEDIARY: "bg-yellow-400/15 border-yellow-400/40 text-yellow-400",
  CREATOR:      "bg-green-400/15  border-green-400/40  text-green-400",
  GROUP:        "bg-purple-400/15 border-purple-400/40 text-purple-400",
  PERSON:       "bg-pink-400/15   border-pink-400/40   text-pink-400",
};

export function resolveAddress(
  address: string,
  bookEntries: AddressBookEntry[],
  intermediaries: KnownIntermediary[],
  creators: KnownCreator[],
  groups: AssetGroup[],
  persons: Person[] = [],
): ResolvedAddress {
  // 0. Person — most specific fact available: a named human/entity owns this address
  const person = persons.find((p) => p.addresses.some((a) => a.address === address));
  if (person) return {
    name: person.name,
    source: "person",
    badge: "PERSON",
    badgeClass: BADGE.PERSON,
  };

  // 1. Known Intermediary — globally curated entity
  const intermediary = intermediaries.find((e) => e.address === address);
  if (intermediary) return {
    name: intermediary.name,
    source: "intermediary",
    badge: "INTERMEDIARY",
    badgeClass: BADGE.INTERMEDIARY,
  };

  // 2. Known Creator — globally curated entity
  const creator = creators.find((e) => e.address === address);
  if (creator) return {
    name: creator.name,
    source: "creator",
    badge: "CREATOR",
    badgeClass: BADGE.CREATOR,
  };

  // 3. Asset Group member — structured investigation role (beats plain address book label)
  for (const g of groups) {
    const member = g.members.find((m) => m.address === address);
    if (member) return {
      name: member.label || g.name,
      source: "group",
      badge: member.role.toUpperCase(),
      badgeClass: BADGE.GROUP,
    };
  }

  // 4. Address Book — personal free-form label
  const bookEntry = bookEntries.find((e) => e.publicKey === address);
  if (bookEntry) return { name: bookEntry.label, source: "book" };

  return { source: "none" };
}
