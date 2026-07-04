import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { AddressInvestigatorTab } from "@/components/address-investigator/AddressInvestigatorTab";

export default function AddressInvestigatorPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Account Investigator
          </h1>
          <p className="text-muted-foreground mt-2">
            Deep-dive any Stellar account — see all incoming and outgoing XLM flows, top counterparties, operation history, and save key addresses to your groups.
          </p>
        </div>
        <Link
          href="/intermediary-tracer"
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Trace account origin →
        </Link>
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
