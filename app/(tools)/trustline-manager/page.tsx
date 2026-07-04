// app/(tools)/trustline-manager/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { TrustlineManagerPanel } from "@/components/trustline-manager/TrustlineManagerPanel";

export default function TrustlineManagerPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trustline Manager</h1>
          <p className="text-muted-foreground mt-2">
            Add trustlines to custom Stellar assets — one at a time or in bulk
            across many accounts and assets simultaneously.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link
            href="/asset-creator"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            ← Create asset
          </Link>
          <Link
            href="/asset-manager"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Token Control →
          </Link>
        </div>
      </div>
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        }
      >
        <TrustlineManagerPanel />
      </Suspense>
    </div>
  );
}
