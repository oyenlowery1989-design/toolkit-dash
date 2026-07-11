import type { AssetGroup } from "@/lib/asset-groups/types";
import type { Person } from "@/lib/persons/types";
import { normalizeChannel } from "@/lib/asset-groups/links";
import { groupsForAddress } from "@/lib/persons/address-groups";

export interface PersonTelegramChannel {
  key: string;
  raw: string;
  link?: string;
}

/** Every distinct Telegram channel connected to this person: channels on
 *  groups they're attributed to, plus channels on groups any of their
 *  linked addresses belong to. Deduped by normalized channel name. Carries
 *  the originating group's explicit telegramLink (if set) so callers can
 *  defer to resolveTelegramUrl's "explicit link wins" contract instead of
 *  always deriving a t.me URL from the channel name. */
export function telegramChannelsForPerson(person: Person, groups: AssetGroup[]): PersonTelegramChannel[] {
  const seen = new Map<string, { raw: string; link?: string }>();

  const attributedGroups = groups.filter((g) => g.personId === person.id);
  const addressGroups = person.addresses.flatMap((a) => groupsForAddress(a.address, groups));

  for (const g of [...attributedGroups, ...addressGroups]) {
    if (!g.telegramChannel) continue;
    const key = normalizeChannel(g.telegramChannel);
    if (!key || seen.has(key)) continue;
    seen.set(key, { raw: g.telegramChannel, link: g.telegramLink });
  }

  return [...seen.entries()].map(([key, v]) => ({ key, raw: v.raw, link: v.link }));
}
