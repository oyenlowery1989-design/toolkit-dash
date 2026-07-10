import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { KeyScannerPanel } from "@/components/key-scanner/KeyScannerPanel";

export default function KeyScannerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Key Scanner</h1>
        <p className="text-muted-foreground mt-2">
          Continuously generates random Stellar keypairs and checks each for an existing on-ledger balance, sorting into a no-balance and a has-balance bucket, until you stop it.
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
        <KeyScannerPanel />
      </Suspense>
    </div>
  );
}
