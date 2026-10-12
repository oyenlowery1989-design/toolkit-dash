"use client";

import { useEffect, useRef } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { RevokeSponsorshipPanel } from "@/components/shared/sponsorship/RevokeSponsorshipPanel";
import type { PaymentsController } from "./usePaymentsController";

type SponsorshipTabProps = Pick<PaymentsController,
  | "currentPublicKey"
  | "signingWalletId"
  | "hasSigningKey"
  | "signerKeypair"
  | "horizonServer"
  | "horizonUrl"
  | "network"
>;

export function SponsorshipTab({ currentPublicKey, signingWalletId, hasSigningKey, signerKeypair, horizonServer, horizonUrl, network }: SponsorshipTabProps) {
  const identity = `${signingWalletId ?? "manual"}:${currentPublicKey ?? ""}`;
  const identityRef = useRef(identity);
  useEffect(() => { identityRef.current = identity; }, [identity]);
  return (
    <TabsContent value="sponsorship" className="space-y-3 mt-3">
      {currentPublicKey ? (
        <RevokeSponsorshipPanel
          sponsorPublicKey={currentPublicKey}
          signerKeypair={signerKeypair}
          walletId={hasSigningKey ? signingWalletId : null}
          assertSignerCurrent={() => {
            if (identityRef.current !== identity) throw new Error("Signing wallet changed; retry the transaction");
          }}
          horizonServer={horizonServer}
          horizonUrl={horizonUrl}
          network={network}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Connect a wallet or enter a secret key above to check and revoke sponsorships.
        </p>
      )}
    </TabsContent>
  );
}
