"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FingerprintTab } from "./FingerprintTab";
import { BulkTraceTab } from "./BulkTraceTab";
import { WatchlistTab } from "./WatchlistTab";
import { FlowGraphTab } from "./FlowGraphTab";

type TabValue = "fingerprint" | "bulk" | "watchlist" | "graph";
const VALID_TABS: TabValue[] = ["fingerprint", "bulk", "watchlist", "graph"];

function InitialTabReader({ onTab }: { onTab: (t: TabValue) => void }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const addressesParam = searchParams.get("addresses");
  useEffect(() => {
    if (tabParam && (VALID_TABS as string[]).includes(tabParam)) {
      onTab(tabParam as TabValue);
    } else if (addressesParam) {
      onTab("bulk");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, addressesParam]);
  return null;
}

export function TracerV2Panel() {
  const [activeTab, setActiveTab] = useState<TabValue>("fingerprint");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tracer v2</h1>
        <p className="text-muted-foreground mt-2">
          Correlate asset groups by shared operators using data already collected across the toolkit.
        </p>
      </div>
      <Suspense fallback={null}>
        <InitialTabReader onTab={setActiveTab} />
      </Suspense>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList className="flex-wrap h-auto gap-y-1">
          <TabsTrigger value="fingerprint">Operator Fingerprint</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Trace</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="graph">Flow Graph</TabsTrigger>
        </TabsList>
        <TabsContent value="fingerprint" className="mt-6 space-y-4">
          <FingerprintTab />
        </TabsContent>
        <TabsContent value="bulk" className="mt-6 space-y-4">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            }
          >
            <BulkTraceTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="watchlist" className="mt-6 space-y-4">
          <WatchlistTab />
        </TabsContent>
        <TabsContent value="graph" className="mt-6">
          <FlowGraphTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
