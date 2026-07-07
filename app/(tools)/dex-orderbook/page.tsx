import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { DexOrderbookPanel } from "@/components/dex-orderbook/DexOrderbookPanel";

export default function OrderbookPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">DEX Orderbook</h1>
        <p className="text-muted-foreground mt-2">
          Live bid/ask tables, spread stats, and depth chart for any Stellar DEX pair. Choose from presets or enter any asset code and issuer.
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
        <DexOrderbookPanel />
      </Suspense>
    </div>
  );
}
