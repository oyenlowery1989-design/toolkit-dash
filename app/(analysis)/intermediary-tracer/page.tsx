import { Suspense } from "react";
import { Loader2, GitFork } from "lucide-react";
import { IntermediaryTracerPanel } from "@/components/intermediary-tracer/IntermediaryTracerPanel";

export const metadata = {
  title: "Intermediary Tracer | Stellar Toolkit",
  description: "Trace the real origin of Stellar accounts created through exchange intermediaries.",
};

export default function IntermediaryTracerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <GitFork className="h-7 w-7" />
          Intermediary Tracer
        </h1>
        <p className="text-muted-foreground mt-2">
          Uncover the real controllers behind Stellar accounts created through exchange
          intermediaries (ChangeNow, SimpleSwap, etc.) by correlating payments with{" "}
          <code className="text-xs">create_account</code> operations. Build a registry
          of known actors and map their full account ancestry.
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
        <IntermediaryTracerPanel />
      </Suspense>
    </div>
  );
}
