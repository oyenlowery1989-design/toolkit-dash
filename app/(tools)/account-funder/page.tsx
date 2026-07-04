import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AccountFunderPanel } from "@/components/account-funder/AccountFunderPanel";

export default function AccountFunderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account Funder</h1>
        <p className="text-muted-foreground mt-2">
          Generate new Stellar keypairs and fund them in one step. Useful for creating a set of sender accounts for Ghost Payments or any batch operation. Keys are generated in your browser, funded via <code>createAccount</code>, and can be saved to an Asset Group.
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
        <AccountFunderPanel />
      </Suspense>
    </div>
  );
}
