"use client";

/**
 * ChainDisplay + CreatorPeek — shared ancestry-tracing UI.
 *
 * Used by AssetLookupPanel (issuer + distrib chains).
 * Can be imported by AddressInvestigatorTab once needed.
 */

import { useState, useEffect, useRef } from "react";
import { Horizon } from "stellar-sdk";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortAddress } from "@/components/asset-lookup/ShortAddress";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import type { GroupMemberRole } from "@/lib/asset-groups/types";
import { ROLE_LABELS } from "@/lib/asset-groups/types";
import { fetchAccountCreation } from "@/lib/intermediary-tracer/fetchers";
import { fetchAccountCreator } from "@/lib/asset-lookup";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainNode {
  /** The direct creator of the current address (from create_account funder field) */
  creator: string;
  /** "intermediary" → payment-scan was used; "direct" → creator IS the answer; "pruned" → history unavailable */
  creatorType: "intermediary" | "direct" | "pruned";
  /** Only set for intermediary nodes: the real operator behind the intermediary */
  realOwner?: string;
  confidence?: number;
  noNative?: boolean;
  /** home_domain of the creator account, if any */
  homeDomain?: string;
  /** home_domain of the realOwner account, if any */
  realOwnerHomeDomain?: string;
}

export interface ChainState {
  status: "idle" | "loading" | "done" | "error";
  chain: ChainNode[];
  searching?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function fetchHomeDomain(
  horizonUrl: string,
  address: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`, { signal });
    if (!res.ok) return undefined;
    const data = await res.json();
    return (data.home_domain as string | undefined) || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// CreatorPeek — "Who created?" button for a realOwner node
// ---------------------------------------------------------------------------

export function CreatorPeek({
  address,
  network,
  horizonUrl,
  knownIntermediaries,
}: {
  address: string;
  network: "public" | "testnet";
  horizonUrl: string;
  knownIntermediaries: Set<string>;
}) {
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [creator, setCreator] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleLookup = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    setCreator(null);
    setError(null);

    try {
      const creation = await fetchAccountCreation(
        horizonUrl,
        address,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;

      let creatorAddress: string | null = creation?.funder ?? null;
      if (!creatorAddress) {
        const server = new Horizon.Server(horizonUrl);
        creatorAddress = await fetchAccountCreator(
          server,
          address,
          ctrl.signal,
        );
      }

      if (ctrl.signal.aborted) return;
      setCreator(creatorAddress ?? null);
      setStatus("done");
    } catch {
      if (ctrl.signal.aborted) return;
      setError("Lookup failed");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-0.5">
      <button
        className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline disabled:opacity-60"
        onClick={handleLookup}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Checking creator..." : "Who created?"}
      </button>

      {status === "done" && creator && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 flex-wrap">
          <span>created by</span>
          <ShortAddress address={creator} network={network} />
          {knownIntermediaries.has(creator) && (
            <span className="text-[9px] uppercase tracking-wide font-semibold text-yellow-500/90">
              intermediary
            </span>
          )}
        </div>
      )}

      {status === "done" && !creator && (
        <div className="text-[10px] text-muted-foreground/40 italic">
          creation record unavailable on current Horizon history
        </div>
      )}

      {status === "error" && (
        <div className="text-[10px] text-destructive">
          {error ?? "Lookup failed"}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChainDisplay — renders a recursive ancestry chain
// ---------------------------------------------------------------------------

export function ChainDisplay({
  chain,
  network,
  assetCode,
  issuer,
  horizonUrl,
  knownIntermediaryAddrs,
  onContinue,
}: {
  chain: ChainState;
  network: "public" | "testnet";
  assetCode: string;
  issuer: string;
  horizonUrl: string;
  knownIntermediaryAddrs: Set<string>;
  onContinue: (fromAddress: string) => void;
}) {
  const { groups, createGroup, upsertMember } = useAssetGroups();

  const [addDialog, setAddDialog] = useState<{
    address: string;
    label: string;
    role: GroupMemberRole;
  } | null>(null);
  const [dialogLabel, setDialogLabel] = useState("");
  const [dialogRole, setDialogRole] = useState<GroupMemberRole>("creator");
  // Track addresses already saved this session
  const [savedAddrs, setSavedAddrs] = useState<Set<string>>(new Set());

  const targetGroup = groups.find(
    (g) =>
      g.assetCode?.toUpperCase() === assetCode.toUpperCase() &&
      g.issuer === issuer &&
      g.network === network,
  );

  const openDialog = (
    address: string,
    defaultLabel: string,
    defaultRole: GroupMemberRole,
  ) => {
    setAddDialog({ address, label: defaultLabel, role: defaultRole });
    setDialogLabel(defaultLabel);
    setDialogRole(defaultRole);
  };

  const saveToGroup = () => {
    if (!addDialog) return;
    let groupId: string;
    if (targetGroup) {
      groupId = targetGroup.id;
    } else {
      groupId = createGroup({
        name: `${assetCode} Asset`,
        assetCode,
        issuer,
        network,
      });
    }
    const alreadyMember = (targetGroup?.members ?? []).find(
      (m) => m.address === addDialog.address,
    );
    if (!alreadyMember) {
      upsertMember(groupId, {
        address: addDialog.address,
        role: dialogRole,
        label: dialogLabel.trim() || undefined,
      });
    }
    setSavedAddrs((prev) => new Set([...prev, addDialog.address]));
    setAddDialog(null);
  };

  if (chain.status === "idle") return null;

  const getGroupInfo = (address: string) => {
    for (const g of groups) {
      const member = g.members.find((m) => m.address === address);
      if (member) return { group: g, member };
    }
    if (savedAddrs.has(address)) {
      return { group: targetGroup ?? null, member: null };
    }
    return null;
  };

  let directCount = 0;

  return (
    <>
      <Dialog open={!!addDialog} onOpenChange={(o) => !o && setAddDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Group</p>
              <p className="text-sm font-medium">
                {targetGroup?.name ?? `${assetCode} Asset`}
                {!targetGroup && (
                  <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                    (will be created)
                  </span>
                )}
              </p>
            </div>
            {addDialog && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Address</p>
                <ShortAddress address={addDialog.address} network={network} />
              </div>
            )}
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                className="h-7 mt-1 text-sm"
                value={dialogLabel}
                onChange={(e) => setDialogLabel(e.target.value)}
                placeholder="Optional label…"
              />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select
                value={dialogRole}
                onValueChange={(v) => setDialogRole(v as GroupMemberRole)}
              >
                <SelectTrigger className="h-7 mt-1 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(ROLE_LABELS) as [GroupMemberRole, string][]
                  ).map(([role, label]) => (
                    <SelectItem key={role} value={role}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddDialog(null)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={saveToGroup}>
              Save to Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-0.5">
        {chain.chain.map((node, depth) => {
          if (node.creatorType === "direct") directCount++;
          const creatorNum = directCount;

          return (
            <div
              key={depth}
              className="flex flex-col gap-0.5"
              style={{ paddingLeft: `${(depth + 1) * 12}px` }}
            >
              {node.creatorType === "direct" ? (
                <div className="flex items-center gap-1 text-[10px] flex-wrap">
                  <span className="text-muted-foreground/50">
                    ↳ Creator {creatorNum}
                  </span>
                  <ShortAddress address={node.creator} network={network} />
                  {node.homeDomain && (
                    <span className="text-[9px] text-muted-foreground/50 font-mono">
                      {node.homeDomain}
                    </span>
                  )}
                  {node.creator === issuer && (
                    <span className="inline-flex items-center px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide leading-none bg-amber-400/15 border-amber-400/40 text-amber-400">
                      ISSUER
                    </span>
                  )}
                  {(() => {
                    const info = getGroupInfo(node.creator);
                    return info ? (
                      <a
                        href={
                          info.group?.id
                            ? `/groups?open=${info.group.id}`
                            : "/groups"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-green-400/80 hover:text-green-400 underline-offset-2 hover:underline"
                        title={[
                          `Group: ${info.group?.name ?? "saved"}`,
                          info.member?.label
                            ? `Label: ${info.member.label}`
                            : null,
                          info.member?.role
                            ? `Role: ${info.member.role}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        ✓ in group
                      </a>
                    ) : (
                      <button
                        className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline"
                        onClick={() =>
                          openDialog(
                            node.creator,
                            `Creator ${creatorNum} ${assetCode}`,
                            "creator",
                          )
                        }
                      >
                        + Group
                      </button>
                    );
                  })()}
                  {depth === chain.chain.length - 1 &&
                    chain.status === "done" && (
                      <button
                        className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline ml-1"
                        onClick={() => onContinue(node.creator)}
                      >
                        Continue →
                      </button>
                    )}
                </div>
              ) : node.creatorType === "pruned" ? (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40 italic flex-wrap">
                  <span>↳ creation history pruned from Horizon for</span>
                  <ShortAddress address={node.creator} network={network} />
                  <a
                    href={`https://stellar.expert/explorer/${network}/account/${node.creator}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="not-italic text-[9px] text-primary/60 hover:text-primary underline-offset-2 hover:underline"
                    title="View full history on Stellar Expert"
                  >
                    view on Stellar.Expert ↗
                  </a>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 flex-wrap">
                    <span>↳ created by</span>
                    <ShortAddress address={node.creator} network={network} />
                    {node.homeDomain && (
                      <span className="text-[9px] text-muted-foreground/50 font-mono">
                        {node.homeDomain}
                      </span>
                    )}
                    {node.creator === issuer ? (
                      <span className="inline-flex items-center px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide leading-none bg-amber-400/15 border-amber-400/40 text-amber-400">
                        ISSUER
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide leading-none bg-yellow-400/15 border-yellow-400/40 text-yellow-400">
                        INTERMEDIARY
                      </span>
                    )}
                  </div>
                  <div style={{ paddingLeft: "12px" }}>
                    {node.realOwner ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[10px] flex-wrap">
                          <span className="text-muted-foreground/40">
                            → real owner
                          </span>
                          <ShortAddress
                            address={node.realOwner}
                            network={network}
                          />
                          {node.realOwnerHomeDomain && (
                            <span className="text-[9px] text-muted-foreground/50 font-mono">
                              {node.realOwnerHomeDomain}
                            </span>
                          )}
                          {node.realOwner === issuer && (
                            <span className="inline-flex items-center px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide leading-none bg-amber-400/15 border-amber-400/40 text-amber-400">
                              ISSUER
                            </span>
                          )}
                          {node.confidence !== undefined && (
                            <span className="text-muted-foreground/40">
                              ({node.confidence}% confidence)
                            </span>
                          )}
                          {(() => {
                            const info = getGroupInfo(node.realOwner!);
                            return info ? (
                              <a
                                href={
                                  info.group?.id
                                    ? `/groups?open=${info.group.id}`
                                    : "/groups"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[9px] text-green-400/80 hover:text-green-400 underline-offset-2 hover:underline"
                                title={[
                                  `Group: ${info.group?.name ?? "saved"}`,
                                  info.member?.label
                                    ? `Label: ${info.member.label}`
                                    : null,
                                  info.member?.role
                                    ? `Role: ${info.member.role}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              >
                                ✓ in group
                              </a>
                            ) : (
                              <button
                                className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline"
                                onClick={() =>
                                  openDialog(
                                    node.realOwner!,
                                    `Real owner ${assetCode}`,
                                    "creator",
                                  )
                                }
                              >
                                + Group
                              </button>
                            );
                          })()}
                        </div>
                        {depth === chain.chain.length - 1 &&
                          chain.status === "done" && (
                            <div
                              style={{ paddingLeft: "8px" }}
                              className="flex flex-col gap-0.5 mt-0.5"
                            >
                              <button
                                className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline w-fit"
                                onClick={() => onContinue(node.realOwner!)}
                              >
                                Continue →
                              </button>
                              <CreatorPeek
                                address={node.realOwner}
                                network={network}
                                horizonUrl={horizonUrl}
                                knownIntermediaries={knownIntermediaryAddrs}
                              />
                            </div>
                          )}
                      </div>
                    ) : node.noNative ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[10px] text-muted-foreground/40 italic">
                          funded via non-XLM asset
                        </div>
                        {depth === chain.chain.length - 1 &&
                          chain.status === "done" && (
                            <button
                              className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline w-fit"
                              onClick={() => onContinue(node.creator)}
                            >
                              Continue from intermediary →
                            </button>
                          )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[10px] text-muted-foreground/40 italic">
                          real operator not identified
                        </div>
                        {depth === chain.chain.length - 1 &&
                          chain.status === "done" && (
                            <button
                              className="text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline w-fit"
                              onClick={() => onContinue(node.creator)}
                            >
                              Continue from intermediary →
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {chain.status === "loading" && (
          <div
            className="flex items-center gap-1 text-[10px] text-muted-foreground/40 animate-pulse"
            style={{ paddingLeft: `${(chain.chain.length + 1) * 12}px` }}
          >
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {chain.searching
              ? `tracing ${chain.searching.slice(0, 4)}…${chain.searching.slice(-4)}`
              : "searching…"}
          </div>
        )}

        {chain.status === "error" && (
          <div className="text-[10px] text-destructive pl-3">
            {chain.error}
          </div>
        )}
      </div>
    </>
  );
}
