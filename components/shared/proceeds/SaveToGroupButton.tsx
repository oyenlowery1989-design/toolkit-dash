"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm } from "@/lib/format";
import { defaultGroupMemberLabel, ROLE_LABELS } from "@/lib/asset-groups/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { DestinationSummary } from "@/lib/proceeds-investigator/types";

const SIZE_CLASSES: Record<"default" | "sm", string> = {
  default: "px-3 py-1.5 text-xs gap-1.5",
  sm: "px-2 py-0.5 text-[10px] gap-1",
};

/** A single destination is a clear bank candidate when it dominates the others
 *  (2x+ the runner-up) or it's the only destination on record. Otherwise ambiguous. */
function pickBankCandidate(destinations: DestinationSummary[] | undefined): {
  auto?: DestinationSummary;
  ambiguous: DestinationSummary[];
} {
  if (!destinations || destinations.length === 0) return { ambiguous: [] };
  const sorted = [...destinations].sort((a, b) => b.totalXlm - a.totalXlm);
  const [top, second] = sorted;
  if (!second || top.totalXlm >= second.totalXlm * 2) {
    return { auto: top, ambiguous: [] };
  }
  return { ambiguous: sorted.slice(0, 5) };
}

export function saveAssetGroup(opts: {
  assetCode: string;
  issuer: string;
  network: string;
  distribAddress?: string;
  homeDomain?: string;
  distribHomeDomain?: string;
  bankAddress?: string;
}, actions: {
  createGroup: (entry: { name: string; assetCode: string; issuer: string; network: string }) => string;
  upsertMember: (groupId: string, member: { address: string; role: "issuer" | "distributor" | "bank"; label?: string; homeDomain?: string }) => void;
}) {
  const id = actions.createGroup({
    name: `${opts.assetCode} Asset`,
    assetCode: opts.assetCode,
    issuer: opts.issuer,
    network: opts.network,
  });
  actions.upsertMember(id, {
    address: opts.issuer,
    role: "issuer",
    label: defaultGroupMemberLabel("issuer", opts.assetCode),
    homeDomain: opts.homeDomain,
  });
  if (opts.distribAddress) {
    actions.upsertMember(id, {
      address: opts.distribAddress,
      role: "distributor",
      label: defaultGroupMemberLabel("distributor", opts.assetCode),
      homeDomain: opts.distribHomeDomain,
    });
  }
  if (opts.bankAddress) {
    actions.upsertMember(id, {
      address: opts.bankAddress,
      role: "bank",
      label: defaultGroupMemberLabel("bank", opts.assetCode),
    });
  }
  return id;
}

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
  /** Top outgoing destinations (asset-level save only) — used to auto-detect a
   *  dominant "bank" destination, or prompt for confirmation when ambiguous. */
  topDestinations?: DestinationSummary[];
  size?: "default" | "sm";
}

/** Save-to-Group / Open-Group / +Bank / in-group action button.
 *  Covers both asset-level saves (issuer+distrib, optionally auto-detected bank)
 *  and per-destination "add as bank" actions. */
export function SaveToGroupButton({
  assetCode,
  issuer,
  network,
  distribAddress,
  homeDomain,
  distribHomeDomain,
  targetAddress,
  topDestinations,
  size = "default",
}: SaveToGroupButtonProps) {
  const { groups, createGroup, upsertMember } = useAssetGroups();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);

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
  const save = (bankAddress?: string) => {
    saveAssetGroup(
      { assetCode, issuer, network, distribAddress, homeDomain, distribHomeDomain, bankAddress },
      { createGroup, upsertMember },
    );
    setConfirmOpen(false);
  };

  if (existingGroup && (!targetAddress || alreadyMember)) {
    return (
      <>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setConfirmOpen(true)}
          title={targetAddress ? "Show group summary" : "Show group summary"}
          className={`inline-flex items-center rounded border border-green-400/40 bg-green-400/10 font-medium text-green-400 hover:bg-green-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
        >
          <Layers className="h-3.5 w-3.5" />
          {targetAddress ? "✓ in group" : "✓ saved"}
        </Button>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{existingGroup.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {existingGroup.assetCode ?? "No asset code"} · {existingGroup.network} · {existingGroup.members.length} members
              </p>
              {existingGroup.issuer && (
                <div className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Issuer</span>
                  <ShortAddress address={existingGroup.issuer} network={existingGroup.network} />
                </div>
              )}
              <div className="space-y-1 pt-1">
                {existingGroup.members.map((member) => (
                  <div key={member.id} className="rounded border px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {ROLE_LABELS[member.role]}{member.label ? ` · ${member.label}` : ""}
                      </span>
                      <ShortAddress address={member.address} network={existingGroup.network} />
                    </div>
                    {member.homeDomain && (
                      <p className="mt-1 text-muted-foreground">{member.homeDomain}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button asChild>
                <a href={`/groups?open=${existingGroup.id}`}>Open Group</a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (targetAddress) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => save(targetAddress)}
        title="Add to group as Bank"
        className={`inline-flex items-center rounded border border-purple-400/40 bg-purple-400/10 font-medium text-purple-400 hover:bg-purple-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
      >
        <Layers className="h-3.5 w-3.5" />
        + Bank
      </Button>
    );
  }

  const { auto, ambiguous } = pickBankCandidate(topDestinations);

  if (ambiguous.length > 1) {
    return (
      <>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`inline-flex items-center rounded border border-purple-400/40 bg-purple-400/10 font-medium text-purple-400 hover:bg-purple-400/20 h-auto ${sizeCls}`}
          onClick={() => setConfirmOpen(true)}
          title="Save issuer + distrib to an Asset Group"
        >
          <Layers className="h-3.5 w-3.5" />
          Save to Group
        </Button>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Which destination is the bank?</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Issuer and distrib will be saved automatically. No single destination
              clearly dominates outgoing XLM — pick the one that's the bank / cash-out
              address, or skip.
            </p>
            <div className="space-y-1.5">
              {ambiguous.map((d) => (
                <div
                  key={d.address}
                  className={`w-full flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors ${
                    selectedBank === d.address
                      ? "border-purple-400 bg-purple-400/10"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="bank-candidate"
                    value={d.address}
                    checked={selectedBank === d.address}
                    onChange={() => setSelectedBank(d.address)}
                    aria-label={`Select ${d.address} as bank`}
                    className="shrink-0 accent-purple-500"
                  />
                  <span className="min-w-0 flex-1">
                    <ShortAddress address={d.address} network={network} />
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatXlm(d.totalXlm)} XLM
                  </span>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => save()}
                className="inline-flex items-center justify-center rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
              >
                Skip bank
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => selectedBank && save(selectedBank)}
                disabled={!selectedBank}
                className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium ${
                  selectedBank
                    ? "bg-purple-500 text-white hover:bg-purple-600"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Save with bank
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => save(auto?.address)}
      title="Save issuer + distrib to an Asset Group"
      className={`inline-flex items-center rounded border border-purple-400/40 bg-purple-400/10 font-medium text-purple-400 hover:bg-purple-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
    >
      <Layers className="h-3.5 w-3.5" />
      Save to Group
    </Button>
  );
}
