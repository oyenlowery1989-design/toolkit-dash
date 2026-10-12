import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PaymentsPanel } from "@/components/payments/PaymentsPanel";

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}>
      <PaymentsPanel />
    </Suspense>
  );
}
