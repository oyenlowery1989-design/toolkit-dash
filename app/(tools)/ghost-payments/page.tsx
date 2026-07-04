import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { GhostPaymentsPanel } from "@/components/ghost-payments/GhostPaymentsPanel";

export default function GhostPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ghost Payments</h1>
        <p className="text-muted-foreground mt-2">
          Send real micro-payments as permanent on-chain proof of contact. Each transaction is publicly visible on Horizon and Stellar.Expert with your custom memo attached — useful for claim proofs, eligibility signals, and timestamped on-chain messaging.
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
