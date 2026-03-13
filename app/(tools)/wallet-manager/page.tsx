import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { WalletManagerPanel } from "@/components/wallet-manager/WalletManagerPanel";

export default function WalletManagerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet Manager</h1>
        <p className="text-muted-foreground mt-2">
          Save and organise your Stellar wallets into folders. Connect a wallet
          to use it automatically in Bulk Payments, Ghost Payments, and other
          signing modules.
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
        <WalletManagerPanel />
      </Suspense>
    </div>
  );
}
