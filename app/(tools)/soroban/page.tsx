// app/(tools)/soroban/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { SorobanPanel } from "@/components/soroban/SorobanPanel";

export default function SorobanPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Soroban Contracts</h1>
          <p className="text-muted-foreground mt-2">
            Wrap an existing classic Stellar asset with a Soroban smart contract (SAC). This gives your token a contract address so it can interact with Soroban DeFi protocols — your asset stays on the native DEX unchanged.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link
            href="/asset-creator"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            ← Create new asset
          </Link>
          <Link
            href="/asset-manager"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            ← Token Control
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
        <SorobanPanel />
      </Suspense>
    </div>
  );
}
