"use client";

import { Layers } from "lucide-react";
import { useAssetGroups } from "@/hooks/use-asset-groups";

const SIZE_CLASSES: Record<"default" | "sm", string> = {
  default: "px-3 py-1.5 text-xs gap-1.5",
  sm: "px-2 py-0.5 text-[10px] gap-1",
};

interface SaveToGroupButtonProps {
  assetCode: string;
  issuer: string;
  network: string;
  /** Distribution address to save alongside the group (asset-level save only). */
  distribAddress?: string;
  /** Issuer home domain (asset-level save only). */
  homeDomain?: string;
  /** Distributor home domain, separate from the issuer's (asset-level save only). */
  distribHomeDomain?: string;
  /** When set, this button targets a single destination address as a "bank" member
   *  instead of saving the asset-level issuer+distrib pair. */
  targetAddress?: string;
  size?: "default" | "sm";
}

/** Save-to-Group / Open-Group / +Bank / in-group action button.
 *  Covers both asset-level saves (issuer+distrib) and per-destination "add as bank" actions. */
export function SaveToGroupButton({
  assetCode,
  issuer,
  network,
  distribAddress,
  homeDomain,
  distribHomeDomain,
  targetAddress,
  size = "default",
}: SaveToGroupButtonProps) {
  const { groups } = useAssetGroups();
  const existingGroup = groups.find(
    (g) =>
      g.assetCode?.toUpperCase() === assetCode.toUpperCase() &&
      g.issuer === issuer &&
      g.network === network,
  );
  const alreadyMember = targetAddress
    ? existingGroup?.members.find((m) => m.address === targetAddress)
    : undefined;

  const sizeCls = SIZE_CLASSES[size];

  if (existingGroup && (!targetAddress || alreadyMember)) {
    return (
      <a
        href={`/groups?open=${existingGroup.id}`}
        target="_blank"
        rel="noopener noreferrer"
        title={targetAddress ? "Already in group" : undefined}
        className={`inline-flex items-center rounded border border-green-400/40 bg-green-400/10 font-medium text-green-400 hover:bg-green-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
      >
        <Layers className="h-3.5 w-3.5" />
        {targetAddress ? "✓ in group" : "Open Group"}
      </a>
    );
  }

  const params = new URLSearchParams({
    autoCreate: "1",
    name: `${assetCode} Investigation`,
    assetCode,
    issuer,
    network,
  });
  if (distribAddress) params.set("distrib", distribAddress);
  if (homeDomain) params.set("issuerHomeDomain", homeDomain);
  if (distribHomeDomain) params.set("distribHomeDomain", distribHomeDomain);
  if (targetAddress) {
    params.set("addAddress", targetAddress);
    params.set("addRole", "bank");
  }

  return (
    <a
      href={`/groups?${params.toString()}`}
      target="_blank"
      rel="noopener noreferrer"
      title={targetAddress ? "Add to group as Bank" : "Save issuer + distrib to an Asset Group"}
      className={`inline-flex items-center rounded border border-purple-400/40 bg-purple-400/10 font-medium text-purple-400 hover:bg-purple-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
    >
      <Layers className="h-3.5 w-3.5" />
      {targetAddress ? "+ Bank" : "Save to Group"}
    </a>
  );
}
