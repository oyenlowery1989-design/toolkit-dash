"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm } from "@/lib/format";
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

function buildGroupUrl(opts: {
  assetCode: string;
  issuer: string;
  network: string;
  distribAddress?: string;
  homeDomain?: string;
  distribHomeDomain?: string;
  bankAddress?: string;
}) {
  const params = new URLSearchParams({
    autoCreate: "1",
    name: `${opts.assetCode} Investigation`,
    assetCode: opts.assetCode,
    issuer: opts.issuer,
    network: opts.network,
  });
  if (opts.distribAddress) params.set("distrib", opts.distribAddress);
  if (opts.homeDomain) params.set("issuerHomeDomain", opts.homeDomain);
  if (opts.distribHomeDomain) params.set("distribHomeDomain", opts.distribHomeDomain);
  if (opts.bankAddress) {
    params.set("addAddress", opts.bankAddress);
    params.set("addRole", "bank");
    params.set("addLabel", "Bank");
  }
  return `/groups?${params.toString()}`;
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
  const { groups } = useAssetGroups();
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

  if (targetAddress) {
    const params = new URLSearchParams({
      autoCreate: "1",
      name: `${assetCode} Investigation`,
      assetCode,
      issuer,
      network,
      addAddress: targetAddress,
      addRole: "bank",
    });
    return (
      <a
        href={`/groups?${params.toString()}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Add to group as Bank"
        className={`inline-flex items-center rounded border border-purple-400/40 bg-purple-400/10 font-medium text-purple-400 hover:bg-purple-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
      >
        <Layers className="h-3.5 w-3.5" />
        + Bank
      </a>
    );
  }

  const { auto, ambiguous } = pickBankCandidate(topDestinations);

  const baseUrlOpts = { assetCode, issuer, network, distribAddress, homeDomain, distribHomeDomain };

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
                <button
                  key={d.address}
                  type="button"
                  onClick={() => setSelectedBank(d.address)}
                  className={`w-full flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors ${
                    selectedBank === d.address
                      ? "border-purple-400 bg-purple-400/10"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <ShortAddress address={d.address} network={network} />
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatXlm(d.totalXlm)} XLM
                  </span>
                </button>
              ))}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <a
                href={buildGroupUrl(baseUrlOpts)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setConfirmOpen(false)}
                className="inline-flex items-center justify-center rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
              >
                Skip bank
              </a>
              <a
                href={buildGroupUrl({
                  ...baseUrlOpts,
                  bankAddress: selectedBank ?? undefined,
                })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => selectedBank && setConfirmOpen(false)}
                aria-disabled={!selectedBank}
                className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium ${
                  selectedBank
                    ? "bg-purple-500 text-white hover:bg-purple-600"
                    : "pointer-events-none bg-muted text-muted-foreground"
                }`}
              >
                Save with bank
              </a>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <a
      href={buildGroupUrl({ ...baseUrlOpts, bankAddress: auto?.address })}
      target="_blank"
      rel="noopener noreferrer"
      title="Save issuer + distrib to an Asset Group"
      className={`inline-flex items-center rounded border border-purple-400/40 bg-purple-400/10 font-medium text-purple-400 hover:bg-purple-400/20 transition-colors whitespace-nowrap ${sizeCls}`}
    >
      <Layers className="h-3.5 w-3.5" />
      Save to Group
    </a>
  );
}
