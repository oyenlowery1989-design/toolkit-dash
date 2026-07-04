import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { BulkAssetSalesPanel } from "@/components/bulk-asset-sales/BulkAssetSalesPanel";

export default function BulkAssetSalesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bulk Asset Sales</h1>
        <p className="text-muted-foreground mt-2">
          Scan XLM proceeds for multiple assets in one run. Distributors are inferred automatically — results stream live and are auto-saved to Saved Analyses.
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
        <BulkAssetSalesPanel />
      </Suspense>
    </div>
  );
}
