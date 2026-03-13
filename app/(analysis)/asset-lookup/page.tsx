import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AssetLookupPanel } from "@/components/asset-lookup/AssetLookupPanel";

export default function AssetLookupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Lookup</h1>
        <p className="text-muted-foreground mt-2">
          Inspect any Stellar asset — view all holders, issuer details, DEX
          trade history, and distribution insights.
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
        <AssetLookupPanel />
      </Suspense>
    </div>
  );
}
