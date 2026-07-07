"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AssetXlmProceedsTab } from "./AssetXlmProceedsTab";
import { BulkAssetSalesPanel } from "./BulkAssetSalesTab";

type TabValue = "single" | "bulk";
const VALID_TABS: TabValue[] = ["single", "bulk"];

function InitialTabReader({ onTab }: { onTab: (t: TabValue) => void }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (tabParam && (VALID_TABS as string[]).includes(tabParam)) {
      onTab(tabParam as TabValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);
  return null;
}

export function AssetSalesPanel() {
  const [activeTab, setActiveTab] = useState<TabValue>("single");
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <InitialTabReader onTab={setActiveTab} />
      </Suspense>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="single">Single Asset</TabsTrigger>
          <TabsTrigger value="bulk">Bulk</TabsTrigger>
        </TabsList>
        <TabsContent value="single" forceMount className="mt-6 data-[state=inactive]:hidden">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            }
          >
            <AssetXlmProceedsTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="bulk" forceMount className="mt-6 data-[state=inactive]:hidden">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            }
          >
            <BulkAssetSalesPanel />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
