// app/(tools)/asset-creator/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AssetCreatorPanel } from "@/components/asset-creator/AssetCreatorPanel";

export default function AssetCreatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Creator</h1>
        <p className="text-muted-foreground mt-2">
          Create a custom Stellar asset — issue tokens with an issuer and
          distributor account in a guided step-by-step flow.
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
        <AssetCreatorPanel />
      </Suspense>
    </div>
  );
}
