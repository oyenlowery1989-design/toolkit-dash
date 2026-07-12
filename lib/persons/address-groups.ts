import type { AssetGroup } from "@/lib/asset-groups/types";

/** Every asset group where `address` appears as a member, under any role. */
export function groupsForAddress(address: string, groups: AssetGroup[]): AssetGroup[] {
  return groups.filter((g) => g.members.some((m) => m.address === address));
}
