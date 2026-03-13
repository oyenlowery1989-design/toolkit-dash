import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AddressInvestigatorTab } from "@/components/address-investigator/AddressInvestigatorTab";

export default function AddressInvestigatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Account Operations Investigator
        </h1>
        <p className="text-muted-foreground mt-2">
          Investigate account-level native XLM flow with detailed operation
          records, counterparty analytics, and filters.
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
        <AddressInvestigatorTab />
      </Suspense>
    </div>
  );
}
