import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { WalletBalancesPanel } from "@/components/wallet-balances/WalletBalancesPanel";

export default function WalletBalancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet Balances</h1>
        <p className="text-muted-foreground mt-2">
          Live XLM balance across all saved wallets. Filter by folder or asset
          group.
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
        <WalletBalancesPanel />
      </Suspense>
    </div>
  );
}
