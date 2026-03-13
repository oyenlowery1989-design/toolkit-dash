import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { BulkPaymentsPanel } from "@/components/bulk-payments/BulkPaymentsPanel";

export default function BulkPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bulk Payments</h1>
        <p className="text-muted-foreground mt-2">
          Send a minimum XLM payment with a custom memo to many addresses at
          once. Recipients can be entered manually or resolved from asset holder
          lists.
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
        <BulkPaymentsPanel />
      </Suspense>
    </div>
  );
}
