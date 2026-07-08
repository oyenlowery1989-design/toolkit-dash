import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PersonsPanel } from "@/components/persons/PersonsPanel";

export default function PersonsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Persons</h1>
        <p className="text-muted-foreground mt-2">
          Attribute important people — CEOs, founders — to asset groups and addresses.
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
        <PersonsPanel />
      </Suspense>
    </div>
  );
}
