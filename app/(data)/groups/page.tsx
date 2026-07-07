import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { GroupsPanel } from "@/components/groups/GroupsPanel";

export default function GroupsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Groups</h1>
        <p className="text-muted-foreground mt-2">
          Cluster related addresses — issuer, distributor, creator, bank,
          withdrawal — into case files.
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
        <GroupsPanel />
      </Suspense>
    </div>
  );
}
