import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AddressBalancesPanel } from "@/components/address-balances/AddressBalancesPanel";

export default function AddressBalancesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Address Balances</h1>
        <p className="text-muted-foreground mt-2">
          Paste a list of Stellar addresses to check their XLM balance and
          amount available to withdraw.
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
        <AddressBalancesPanel />
      </Suspense>
    </div>
  );
}
