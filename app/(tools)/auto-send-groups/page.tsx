import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AutoSendGroupsPanel } from "@/components/auto-send-groups/AutoSendGroupsPanel";

export default function AutoSendGroupsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Auto-Send Groups</h1>
        <p className="text-muted-foreground mt-2">
          Schedule recurring XLM distributions from a wallet to a set of destinations.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        }
      >
        <AutoSendGroupsPanel />
      </Suspense>
    </div>
  );
}
