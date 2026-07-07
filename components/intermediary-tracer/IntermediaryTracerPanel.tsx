"use client";

import { Search, ScanSearch, ListChecks, Users, GitBranch, Network } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TraceAccountTab } from "./TraceAccountTab";
import { ScanIntermediaryTab } from "./ScanIntermediaryTab";
import { KnownIntermediariesManager } from "./KnownIntermediariesManager";
import { KnownCreatorsManager } from "./KnownCreatorsManager";
import { TraceCreatorTab } from "./TraceCreatorTab";
import { CreatorTreeTab } from "./CreatorTreeTab";

function InfoBanner({
  icon: Icon,
  title,
  description,
  tips,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  tips: string[];
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      {tips.length > 0 && (
        <ul className="space-y-0.5">
          {tips.map((tip, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <span className="text-primary mt-0.5 shrink-0">›</span>
              {tip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntermediaryTracerPanel() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="trace">
        <TabsList className="flex-wrap h-auto gap-y-1">
          <TabsTrigger value="trace">Who Created This Account?</TabsTrigger>
          <TabsTrigger value="scan">Who Did This Intermediary Work For?</TabsTrigger>
          <TabsTrigger value="trace-creator">What Accounts Did This Creator Make?</TabsTrigger>
          <TabsTrigger value="creator-tree">Creator Ancestry Tree</TabsTrigger>
          <TabsTrigger value="intermediaries">Known Intermediaries</TabsTrigger>
          <TabsTrigger value="creators">Known Creators</TabsTrigger>
        </TabsList>

        <TabsContent value="trace" className="mt-6 space-y-4">
          <InfoBanner
            icon={Search}
            title="Who Created This Account?"
            description="Paste any Stellar address to find out who really created it. The tracer checks whether an intermediary service funded the account, then looks back in time to identify which external payment triggered the account creation — revealing the true controller."
            tips={[
              "Works best when the creator used a known intermediary (add them in the Known Intermediaries tab first).",
              "Confidence score reflects how closely the incoming payment amount and timing match the account's starting balance.",
              "Use 'Continue →' on each result node to trace further up the chain toward the grandparent.",
            ]}
          />
          <TraceAccountTab />
        </TabsContent>

        <TabsContent value="scan" className="mt-6 space-y-4">
          <InfoBanner
            icon={ScanSearch}
            title="Who Did This Intermediary Work For?"
            description="Given an intermediary address, scan all accounts it created and identify the funders behind each one. Clusters of accounts funded by the same address reveal mass account creation — a strong signal of a single controller operating at scale."
            tips={[
              "Set 'Scan Period' to cover the time range you're investigating — longer periods take more time.",
              "Cluster Detection groups accounts by their probable funder. Save a cluster directly to a Known Creator's children list.",
              "The amber '↑ scan this funder' hint means the funder is itself a known actor — scan it next to go one level deeper.",
            ]}
          />
          <ScanIntermediaryTab />
        </TabsContent>

        <TabsContent value="trace-creator" className="mt-6 space-y-4">
          <InfoBanner
            icon={GitBranch}
            title="What Accounts Did This Creator Make?"
            description="Given a known real creator and the intermediary they used, find all child accounts they funded. Matches outgoing XLM payments from the creator to the intermediary against subsequent create_account operations, using configurable time windows and amount tolerance."
            tips={[
              "Add the creator and intermediary to their respective lists first so they show in the dropdowns.",
              "Use a tight time window (2–5 min) and low tolerance (1–2%) for high-confidence matches.",
              "Click 'Save N to Creator' after scanning to store the results — re-run next month to discover new accounts added to the same cluster.",
            ]}
          />
          <TraceCreatorTab />
        </TabsContent>

        <TabsContent value="creator-tree" className="mt-6 space-y-4">
          <InfoBanner
            icon={Network}
            title="Creator Ancestry Tree"
            description="View all known creators and the child accounts discovered for each one. Expand any creator to inspect their accounts, enrich them with home domain and asset data, and set parent links to build a full multi-level hierarchy — from grandparent controller down to leaf accounts."
            tips={[
              "Expand a creator and click 'Enrich all' to fetch home domains, issued assets, and distributor balances for each child.",
              "Set a parent address on a creator to link them to their own controller — building the grandparent → parent → children chain.",
              "Use 'Scan for more →' to jump directly to the Intermediary Scan tab pre-filled with that creator's address.",
            ]}
          />
          <CreatorTreeTab />
        </TabsContent>

        <TabsContent value="intermediaries" className="mt-6 space-y-4">
          <InfoBanner
            icon={ListChecks}
            title="Known Intermediaries"
            description="Your registry of intermediary services — exchange platforms, swap services, or any account that acts as a pass-through creator for other people's accounts. Addresses in this list are automatically labelled everywhere in the tool and trigger the 'scan this funder' hint in scan results."
            tips={[
              "Add an address here as soon as you confirm it's an intermediary — all past and future scan results will reflect the label immediately.",
              "Notes field is useful for recording which service the address belongs to and when it was active.",
            ]}
          />
          <KnownIntermediariesManager />
        </TabsContent>

        <TabsContent value="creators" className="mt-6 space-y-4">
          <InfoBanner
            icon={Users}
            title="Known Creators"
            description="Your registry of real account controllers — the people or organisations who use intermediaries to create accounts on their behalf. Once added here, their addresses are labelled everywhere in the tool and their discovered child accounts accumulate in the Creator Ancestry Tree."
            tips={[
              "Add a creator after identifying them via the scan or trace tabs — use the name field to record any known identity or alias.",
              "The parent address field (set in the Creator Tree tab) links this creator to their own controller, enabling multi-level ancestry.",
            ]}
          />
          <KnownCreatorsManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
