import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { GhostPaymentsPanel } from "@/components/ghost-payments/GhostPaymentsPanel";

export default function GhostPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ghost Payments</h1>
        <p className="text-muted-foreground mt-2">
          Send minimal XLM payments that leave a permanent on-chain proof.
          Transactions succeed and are visible on Horizon and Stellar.Expert with
          your memo attached. Use the minimum amount (0.0000001 XLM) to keep costs negligible.
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
        <GhostPaymentsPanel />
      </Suspense>
    </div>
  );
}
