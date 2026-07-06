import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { TieredRewardsPanel } from "@/components/tiered-rewards/TieredRewardsPanel";

export default function TieredRewardsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tiered Rewards</h1>
        <p className="text-muted-foreground mt-2">
          Distribute flat per-holder rewards to asset holders based on their token balance tier.
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
        <TieredRewardsPanel />
      </Suspense>
    </div>
  );
}
