"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShortAddress } from "@/components/asset-lookup";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import { useCreatorChildren } from "@/hooks/use-creator-children";
import { computeFingerprints } from "@/lib/tracer-v2/fingerprint";
import type { EvidenceItem, OperatorMatch, OperatorTier } from "@/lib/tracer-v2/types";
import { cn } from "@/lib/utils";

const TIER_COLORS: Record<OperatorTier, string> = {
  confirmed: "text-red-400 bg-red-400/10",
  strong: "text-orange-400 bg-orange-400/10",
  moderate: "text-yellow-400 bg-yellow-400/10",
  weak: "text-gray-400 bg-gray-400/10",
  hidden: "text-gray-400 bg-gray-400/10",
};

const TIER_LABELS: Record<OperatorTier, string> = {
  confirmed: "Confirmed",
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
  hidden: "Hidden",
};

const SIGNAL_LABELS: Record<EvidenceItem["signal"], string> = {
  "shared-address": "Shared address",
  "shared-destination": "Shared destination",
  "shared-domain": "Shared domain",
  "shared-lineage": "Shared lineage",
};

function GroupLink({ id, name }: { id: string; name: string }) {
  return (
    <a
      href={`/groups?open=${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {name}
      <ExternalLink className="h-3 w-3 text-muted-foreground" />
    </a>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const isAddress = item.signal !== "shared-domain";
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 text-sm border-b border-border/50 last:border-0">
      <span className="text-xs font-medium text-muted-foreground w-36 shrink-0">
        {SIGNAL_LABELS[item.signal]}
      </span>
      {isAddress ? (
        <ShortAddress address={item.entity} />
      ) : (
        <span className="font-mono text-xs">{item.entity}</span>
      )}
      {item.roleA && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {item.roleA}
          {item.roleB && item.roleB !== item.roleA ? ` / ${item.roleB}` : ""}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{item.detail}</span>
      <span className="text-xs text-muted-foreground ml-auto">
        weight {(item.weight * 100).toFixed(0)}
      </span>
    </div>
  );
}

function MatchRow({ match }: { match: OperatorMatch }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = !match.shortCircuit && match.evidence.length > 0;

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50",
          canExpand && "cursor-pointer hover:bg-muted/50",
        )}
        onClick={() => canExpand && setExpanded((e) => !e)}
      >
        <td className="py-2 pr-4">
          <div className="flex items-center gap-1">
            {canExpand ? (
              expanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-4" />
            )}
            <GroupLink id={match.groupAId} name={match.groupAName} />
          </div>
        </td>
        <td className="py-2 pr-4">
          <GroupLink id={match.groupBId} name={match.groupBName} />
        </td>
        <td className="py-2 pr-4 font-medium">{match.score}</td>
        <td className="py-2 pr-4">
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              TIER_COLORS[match.tier],
            )}
          >
            {TIER_LABELS[match.tier]}
          </span>
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {match.shortCircuit ? "—" : match.evidence.length}
        </td>
      </tr>
      {expanded && canExpand && (
        <tr>
          <td colSpan={5} className="bg-muted/20 px-4 py-2">
            <div className="pl-5">
              {match.evidence.map((item, i) => (
                <EvidenceRow key={`${item.signal}-${item.entity}-${i}`} item={item} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function FingerprintTab() {
  const { groups, isLoaded } = useAssetGroups();
  const { analyses } = useSavedAnalyses();
  const { all } = useCreatorChildren();
  const [minScore, setMinScore] = useState(25);

  const matches = useMemo(
    () => computeFingerprints({ groups, analyses, creatorChildren: all, minScore }),
    [groups, analyses, all, minScore],
  );

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="min-score" className="text-xs text-muted-foreground">
            Min score
          </Label>
          <Input
            id="min-score"
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            className="w-24"
          />
        </div>
      </div>

      {groups.length < 2 ? (
        <p className="text-sm text-muted-foreground py-8">
          Fewer than 2 asset groups — nothing to correlate yet.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          No operator correlations at or above score {minScore}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Group A</th>
                <th className="py-2 pr-4 font-medium">Group B</th>
                <th className="py-2 pr-4 font-medium">Score</th>
                <th className="py-2 pr-4 font-medium">Tier</th>
                <th className="py-2 pr-4 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <MatchRow key={`${match.groupAId}-${match.groupBId}`} match={match} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
