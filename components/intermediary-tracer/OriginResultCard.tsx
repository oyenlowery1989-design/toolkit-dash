"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BookUser,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShortAddress } from "@/components/asset-lookup";
import { useAddressBook } from "@/hooks/use-address-book";
import { useKnownCreators, resolveCreatorName } from "@/hooks/use-known-creators";
import type { AccountOriginResult, FunderCandidate } from "@/lib/intermediary-tracer/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDelta(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s before`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s before`;
}

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 80 ? "bg-green-500" : value >= 60 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums font-semibold ${
        value >= 80 ? "text-green-500" : value >= 60 ? "text-yellow-500" : "text-red-400"
      }`}>
        {value}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-add to Address Book form
// ---------------------------------------------------------------------------

function QuickAddToBook({
  address,
  defaultLabel,
  defaultNotes,
  onClose,
}: {
  address: string;
  defaultLabel: string;
  defaultNotes: string;
  onClose: () => void;
}) {
  const { upsert } = useAddressBook();
  const [label, setLabel] = useState(defaultLabel);
  const [notes, setNotes] = useState(defaultNotes);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    upsert({ publicKey: address, label, notes: notes || undefined, color: "red" });
    setSaved(true);
    setTimeout(onClose, 800);
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground font-mono break-all">{address}</p>
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-7 text-xs"
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-7 text-xs"
            placeholder="Optional description…"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!label.trim() || saved}>
          {saved ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <BookUser className="h-3 w-3 mr-1" />}
          {saved ? "Saved!" : "Save to Address Book"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-add to Known Creators form
// ---------------------------------------------------------------------------

function QuickAddToCreators({
  address,
  defaultLabel,
  onClose,
}: {
  address: string;
  defaultLabel: string;
  onClose: () => void;
}) {
  const { upsert } = useKnownCreators();
  const [name, setName] = useState(defaultLabel);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    upsert({ address, name, notes: notes || undefined });
    setSaved(true);
    setTimeout(onClose, 800);
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground font-mono break-all">{address}</p>
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Name / Label</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-xs"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-7 text-xs"
            placeholder="Optional description…"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!name.trim() || saved}>
          {saved ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Check className="h-3 w-3 mr-1" />}
          {saved ? "Saved!" : "Save to Known Creators"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single candidate row
// ---------------------------------------------------------------------------

function CandidateRow({
  candidate,
  network,
  createdAccount,
  intermediary,
  startingBalance,
  createdAt,
}: {
  candidate: FunderCandidate;
  network: string;
  createdAccount: string;
  intermediary: string;
  startingBalance: number;
  createdAt: string;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCreatorForm, setShowCreatorForm] = useState(false);
  const router = useRouter();

  const knownCreatorName = resolveCreatorName(candidate.address);
  const defaultLabel = knownCreatorName ?? `Funder via ${intermediary.slice(0, 4)}…${intermediary.slice(-4)}`;
  const defaultNotes =
    `Funded ${createdAccount.slice(0, 6)}… on ${new Date(createdAt).toLocaleDateString()}, ` +
    `${candidate.sentAmount.toFixed(7)} XLM → intermediary → ${startingBalance.toFixed(7)} XLM (create_account), ` +
    `confidence ${candidate.confidence}%, Δ${formatDelta(candidate.timeDeltaSec)}`;

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      {/* Flow: A → intermediary → new account */}
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <ShortAddress address={candidate.address} network={network as "public" | "testnet"} />
        {knownCreatorName && (
          <span className="text-xs bg-blue-500/15 border border-blue-500/40 text-blue-400 px-1.5 py-0.5 rounded-full font-medium">
            {knownCreatorName}
          </span>
        )}
        <span className="text-muted-foreground">──{candidate.sentAmount.toFixed(2)} XLM──►</span>
        <span className="text-muted-foreground font-mono">[intermediary]</span>
        <span className="text-muted-foreground">──{startingBalance.toFixed(2)} XLM──►</span>
        <ShortAddress address={createdAccount} network={network as "public" | "testnet"} />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 flex-wrap">
        <ConfidenceBar value={candidate.confidence} />
        <span className="text-xs text-muted-foreground">
          Δ{formatDelta(candidate.timeDeltaSec)}
        </span>
        <span className="text-xs text-muted-foreground">
          Δamount {candidate.amountDiffPct.toFixed(2)}%
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(candidate.sentAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Actions */}
      {!showAddForm && !showCreatorForm && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => router.push(`/address-investigator?address=${candidate.address}`)}
          >
            <Search className="h-3 w-3 mr-1" />
            Investigate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setShowAddForm(true)}
          >
            <BookUser className="h-3 w-3 mr-1" />
            Address Book
          </Button>
          {!knownCreatorName && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setShowCreatorForm(true)}
            >
              <Check className="h-3 w-3 mr-1" />
              Known Creator
            </Button>
          )}
        </div>
      )}

      {showAddForm && (
        <QuickAddToBook
          address={candidate.address}
          defaultLabel={defaultLabel}
          defaultNotes={defaultNotes}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {showCreatorForm && (
        <QuickAddToCreators
          address={candidate.address}
          defaultLabel={defaultLabel}
          onClose={() => setShowCreatorForm(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

interface OriginResultCardProps {
  result: AccountOriginResult;
  network: string;
  intermediaryName?: string;
  clusterCount?: number;   // how many times this top funder appears across all results
  minConfidence: number;
}

export function OriginResultCard({
  result,
  network,
  intermediaryName,
  clusterCount,
  minConfidence,
}: OriginResultCardProps) {
  const [expanded, setExpanded] = useState(true);
  const router = useRouter();

  const visibleCandidates = result.candidates.filter(
    (c) => c.confidence >= minConfidence,
  );
  const topFunder = visibleCandidates[0];
  const isCluster = (clusterCount ?? 0) >= 2;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ShortAddress address={result.createdAccount} network={network as "public" | "testnet"} />
            <span className="text-xs text-muted-foreground">
              created {timeAgo(result.createdAt)}
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {result.startingBalance.toFixed(2)} XLM
            </span>
          </div>
        </div>

        {/* Cluster badge */}
        {isCluster && (
          <span className="text-xs bg-orange-500/15 border border-orange-500/40 text-orange-400 px-2 py-0.5 rounded-full font-medium shrink-0">
            CLUSTER ×{clusterCount}
          </span>
        )}

        {/* Top funder preview */}
        {topFunder && !expanded && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <ShortAddress address={topFunder.address} network={network as "public" | "testnet"} />
            <ConfidenceBar value={topFunder.confidence} />
          </div>
        )}

        {result.candidates.length === 0 && (
          <span className="text-xs text-muted-foreground shrink-0">
            {result.noNativeCandidates ? "non-native funding" : "no match"}
          </span>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          {/* Meta */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>
              Created:{" "}
              <span className="text-foreground">
                {new Date(result.createdAt).toLocaleString()}
              </span>
            </span>
            <span>
              Via:{" "}
              <span className="text-foreground">
                {intermediaryName ?? <ShortAddress address={result.intermediary} network={network as "public" | "testnet"} />}
              </span>
            </span>
            <span>
              Starting balance:{" "}
              <span className="text-foreground font-mono">
                {result.startingBalance.toFixed(7)} XLM
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/address-investigator?address=${result.createdAccount}`);
              }}
            >
              <Search className="h-3 w-3 mr-1" />
              Investigate account
            </Button>
          </div>

          {/* Cluster warning */}
          {isCluster && topFunder && (
            <div className="flex items-start gap-2 rounded-md bg-orange-500/10 border border-orange-500/30 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0 mt-0.5" />
              <p className="text-xs text-orange-300">
                This funder (<ShortAddress address={topFunder.address} network={network as "public" | "testnet"} />) appears as the
                probable creator of{" "}
                <span className="font-semibold">{clusterCount} accounts</span> — possible coordinated
                activity.
              </p>
            </div>
          )}

          {/* Candidates */}
          {visibleCandidates.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Probable Funders
              </p>
              {visibleCandidates.map((c) => (
                <CandidateRow
                  key={c.address + c.sentAt}
                  candidate={c}
                  network={network}
                  createdAccount={result.createdAccount}
                  intermediary={result.intermediary}
                  startingBalance={result.startingBalance}
                  createdAt={result.createdAt}
                />
              ))}
              {result.candidates.length > visibleCandidates.length && (
                <p className="text-xs text-muted-foreground">
                  +{result.candidates.length - visibleCandidates.length} low-confidence candidates hidden
                </p>
              )}
            </div>
          ) : result.noNativeCandidates ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              No XLM payments received in the time window — account may have been funded via
              a non-native asset (USDC, BTC, etc.) which cannot be amount-correlated.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              No matching payments found in the ±{Math.round(result.candidates.length)} min window
              above the confidence threshold.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
