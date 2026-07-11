import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AssetSalesTab } from "@/components/asset-sales/AssetSalesTab";

export default function AssetSalesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Sales</h1>
        <p className="text-muted-foreground mt-2">
          Calculate all-time XLM proceeds for one or many assets — see total sold, total outgoing, on-hand balance, and top destination addresses. Auto-saves each result to Saved Analyses.
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
        <AssetSalesTab />
      </Suspense>
    </div>
  );
}
