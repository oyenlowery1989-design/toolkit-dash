import { TieredRewardsPanel } from "@/components/tiered-rewards/TieredRewardsPanel";

export default function TieredRewardsPage() {
  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tiered Rewards</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Distribute flat per-holder rewards to asset holders based on their token balance tier.
        </p>
      </div>
      <TieredRewardsPanel />
    </div>
  );
}
