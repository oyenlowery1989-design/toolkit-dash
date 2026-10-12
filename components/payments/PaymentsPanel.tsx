"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Loader2, ShieldOff, Route, Gift, Zap } from "lucide-react";
import type { PaymentTab } from "@/lib/payments/types";
import { usePaymentsController } from "./usePaymentsController";
import { SendPaymentTab } from "./SendPaymentTab";
import { PathPaymentTab } from "./PathPaymentTab";
import { ClaimableBalanceTab } from "./ClaimableBalanceTab";
import { FeeBumpTab } from "./FeeBumpTab";
import { SponsorshipTab } from "./SponsorshipTab";
import { PaymentsSigningCard } from "./PaymentsSigningCard";
import { PaymentsAddressBook } from "./PaymentsAddressBook";
import { PaymentsMemoFee } from "./PaymentsMemoFee";
import { PaymentsError } from "./PaymentsError";
import { PaymentsConfirmation } from "./PaymentsConfirmation";
import { PaymentsSuccess } from "./PaymentsSuccess";

export function PaymentsPanel() {
  const {
    txStatus,
    txHash,
    network,
    handleCopyHash,
    copied,
    handleReset,
    wallets,
    signingWalletId,
    setSigningWalletId,
    activeTab,
    hasSigningKey,
    showSecret,
    secretKeyDisplay,
    handleSecretKeyChange,
    setShowSecret,
    currentPublicKey,
    setActiveTab,
    balancesLoading,
    balancesError,
    accountBalances,
    loadBalancesRef,
    loadBalances,
    signerCheck,
    legs,
    removeLeg,
    updateLeg,
    fee,
    addressBookEntries,
    setAddressBookTargetLegId,
    setAddressBookOpen,
    addLeg,
    pathMode,
    setPathMode,
    srcIsNative,
    setSrcIsNative,
    srcAssetCode,
    setSrcAssetCode,
    srcAssetIssuer,
    setSrcAssetIssuer,
    maxSendAmount,
    setMaxSendAmount,
    exactSendAmount,
    setExactSendAmount,
    destIsNative,
    setDestIsNative,
    destAssetCode,
    setDestAssetCode,
    destAssetIssuer,
    setDestAssetIssuer,
    destAmount,
    setDestAmount,
    minReceiveAmount,
    setMinReceiveAmount,
    pathDest,
    setPathDest,
    handleFindPaths,
    isFindingPaths,
    pathError,
    paths,
    setSelectedPathIndex,
    selectedPathIndex,
    claimAssetKey,
    setClaimAssetKey,
    claimAmount,
    setClaimAmount,
    claimants,
    setClaimants,
    updateClaimant,
    removeClaimant,
    innerTxXdr,
    setInnerTxXdr,
    innerTxParseError,
    parsedInnerTxOps,
    parsedInnerTxFee,
    parsedInnerTxSigs,
    feeBumpBaseFee,
    setFeeBumpBaseFee,
    innerPerOpFee,
    signerKeypair,
    horizonServer,
    horizonUrl,
    memoValue,
    setMemoValue,
    memoSkipped,
    setMemoSkipped,
    setFee,
    addressBookOpen,
    handleSelectAddress,
    handleRemoveAddress,
    newLabel,
    setNewLabel,
    newKey,
    setNewKey,
    handleAddAddress,
    handleOpenConfirm,
    isSubmitting,
    formValid,
    txError,
    trustlinePrompt,
    handleAddTrustlinesAndRetry,
    trustlineAdding,
    setTrustlinePrompt,
    setTrustlinePromptTab,
    trustlineStatus,
    confirmOpen,
    setConfirmOpen,
    pathsFetchedAt,
    handleSubmit
  } = usePaymentsController();

  if (txStatus === "success" && txHash) {
    return (
      <PaymentsSuccess
        network={network}
        txHash={txHash}
        handleCopyHash={handleCopyHash}
        copied={copied}
        handleReset={handleReset}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Render — Main
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Payments</h1>

      {/* ================================================================== */}
      {/* Signing Card — always at top so balances load immediately          */}
      {/* ================================================================== */}
      <PaymentsSigningCard
        wallets={wallets}
        signingWalletId={signingWalletId}
        setSigningWalletId={setSigningWalletId}
        activeTab={activeTab}
        hasSigningKey={hasSigningKey}
        showSecret={showSecret}
        secretKeyDisplay={secretKeyDisplay}
        handleSecretKeyChange={handleSecretKeyChange}
        setShowSecret={setShowSecret}
        currentPublicKey={currentPublicKey}
        network={network}
      />

      {/* ================================================================== */}
      {/* Payment Tabs                                                       */}
      {/* ================================================================== */}
      <Card>
        <CardContent className="px-4 py-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PaymentTab)}>
            <TabsList className="w-full grid grid-cols-5">
              <TabsTrigger value="send" className="gap-1.5">
                <Send className="h-3.5 w-3.5" />
                Send
              </TabsTrigger>
              <TabsTrigger value="path" className="gap-1.5">
                <Route className="h-3.5 w-3.5" />
                Path
              </TabsTrigger>
              <TabsTrigger value="claimable" className="gap-1.5">
                <Gift className="h-3.5 w-3.5" />
                Claimable
              </TabsTrigger>
              <TabsTrigger value="feebump" className="gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Fee Bump
              </TabsTrigger>
              <TabsTrigger value="sponsorship" className="gap-1.5">
                <ShieldOff className="h-3.5 w-3.5" />
                Sponsorship
              </TabsTrigger>
            </TabsList>

            {/* ---- Tab 1: Send (unified XLM + tokens, multi-leg) ---- */}
            <SendPaymentTab
              balancesLoading={balancesLoading}
              balancesError={balancesError}
              accountBalances={accountBalances}
              loadBalancesRef={loadBalancesRef}
              currentPublicKey={currentPublicKey}
              loadBalances={loadBalances}
              signerCheck={signerCheck}
              legs={legs}
              removeLeg={removeLeg}
              updateLeg={updateLeg}
              fee={fee}
              addressBookEntries={addressBookEntries}
              setAddressBookTargetLegId={setAddressBookTargetLegId}
              setAddressBookOpen={setAddressBookOpen}
              network={network}
              addLeg={addLeg}
            />

            {/* ---- Tab 2: Path Payment ---- */}
            <PathPaymentTab
              pathMode={pathMode}
              setPathMode={setPathMode}
              srcIsNative={srcIsNative}
              setSrcIsNative={setSrcIsNative}
              srcAssetCode={srcAssetCode}
              setSrcAssetCode={setSrcAssetCode}
              srcAssetIssuer={srcAssetIssuer}
              setSrcAssetIssuer={setSrcAssetIssuer}
              maxSendAmount={maxSendAmount}
              setMaxSendAmount={setMaxSendAmount}
              exactSendAmount={exactSendAmount}
              setExactSendAmount={setExactSendAmount}
              destIsNative={destIsNative}
              setDestIsNative={setDestIsNative}
              destAssetCode={destAssetCode}
              setDestAssetCode={setDestAssetCode}
              destAssetIssuer={destAssetIssuer}
              setDestAssetIssuer={setDestAssetIssuer}
              destAmount={destAmount}
              setDestAmount={setDestAmount}
              minReceiveAmount={minReceiveAmount}
              setMinReceiveAmount={setMinReceiveAmount}
              pathDest={pathDest}
              setPathDest={setPathDest}
              addressBookEntries={addressBookEntries}
              setAddressBookOpen={setAddressBookOpen}
              network={network}
              handleFindPaths={handleFindPaths}
              isFindingPaths={isFindingPaths}
              pathError={pathError}
              paths={paths}
              setSelectedPathIndex={setSelectedPathIndex}
              selectedPathIndex={selectedPathIndex}
            />

            {/* ---- Tab 3: Claimable Balance ---- */}
            <ClaimableBalanceTab
              accountBalances={accountBalances}
              claimAssetKey={claimAssetKey}
              setClaimAssetKey={setClaimAssetKey}
              balancesLoading={balancesLoading}
              claimAmount={claimAmount}
              setClaimAmount={setClaimAmount}
              fee={fee}
              claimants={claimants}
              setClaimants={setClaimants}
              updateClaimant={updateClaimant}
              removeClaimant={removeClaimant}
              network={network}
            />

            {/* ---- Tab 4: Fee Bump ---- */}
            <FeeBumpTab
              innerTxXdr={innerTxXdr}
              setInnerTxXdr={setInnerTxXdr}
              innerTxParseError={innerTxParseError}
              parsedInnerTxOps={parsedInnerTxOps}
              parsedInnerTxFee={parsedInnerTxFee}
              parsedInnerTxSigs={parsedInnerTxSigs}
              network={network}
              feeBumpBaseFee={feeBumpBaseFee}
              setFeeBumpBaseFee={setFeeBumpBaseFee}
              innerPerOpFee={innerPerOpFee}
            />

            <SponsorshipTab
              currentPublicKey={currentPublicKey}
              signingWalletId={signingWalletId}
              hasSigningKey={hasSigningKey}
              signerKeypair={signerKeypair}
              horizonServer={horizonServer}
              horizonUrl={horizonUrl}
              network={network}
            />
          </Tabs>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Memo + Fee side-by-side — not shown for fee bump or sponsorship  */}
      {/* ================================================================== */}
      {<PaymentsMemoFee
        activeTab={activeTab}
        memoValue={memoValue}
        setMemoValue={setMemoValue}
        memoSkipped={memoSkipped}
        setMemoSkipped={setMemoSkipped}
        fee={fee}
        setFee={setFee}
      />}

      {/* ================================================================== */}
      {/* Address Book                                                       */}
      {/* ================================================================== */}
      <PaymentsAddressBook
        setAddressBookOpen={setAddressBookOpen}
        addressBookOpen={addressBookOpen}
        addressBookEntries={addressBookEntries}
        handleSelectAddress={handleSelectAddress}
        network={network}
        handleRemoveAddress={handleRemoveAddress}
        newLabel={newLabel}
        setNewLabel={setNewLabel}
        newKey={newKey}
        setNewKey={setNewKey}
        handleAddAddress={handleAddAddress}
      />

      {/* ================================================================== */}
      {/* Submit Button — Sponsorship tab signs/submits itself, no shared    */}
      {/* confirm-dialog flow                                                */}
      {/* ================================================================== */}
      {activeTab !== "sponsorship" && (
        <div className="flex justify-end">
          <Button
            onClick={handleOpenConfirm}
            disabled={isSubmitting || !formValid || !hasSigningKey}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : activeTab === "feebump" ? (
              <Zap className="mr-2 h-4 w-4" />
            ) : activeTab === "claimable" ? (
              <Gift className="mr-2 h-4 w-4" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {txStatus === "building"
              ? "Building..."
              : txStatus === "signing"
                ? "Signing..."
                : txStatus === "submitting"
                  ? "Submitting..."
                  : activeTab === "feebump"
                    ? "Bump Fee & Submit"
                    : activeTab === "claimable"
                      ? "Create Claimable Balance"
                      : "Sign & Submit"}
          </Button>
        </div>
      )}

      {/* ================================================================== */}
      {/* Error display                                                      */}
      {/* ================================================================== */}
      {<PaymentsError
        txStatus={txStatus}
        txError={txError}
        trustlinePrompt={trustlinePrompt}
        handleAddTrustlinesAndRetry={handleAddTrustlinesAndRetry}
        trustlineAdding={trustlineAdding}
        setTrustlinePrompt={setTrustlinePrompt}
        setTrustlinePromptTab={setTrustlinePromptTab}
        trustlineStatus={trustlineStatus}
      />}

      {/* ================================================================== */}
      {/* Confirmation Dialog                                                */}
      {/* ================================================================== */}
      <PaymentsConfirmation
        confirmOpen={confirmOpen}
        setConfirmOpen={setConfirmOpen}
        activeTab={activeTab}
        legs={legs}
        network={network}
        fee={fee}
        memoValue={memoValue}
        pathMode={pathMode}
        pathDest={pathDest}
        selectedPathIndex={selectedPathIndex}
        paths={paths}
        pathsFetchedAt={pathsFetchedAt}
        destAmount={destAmount}
        destIsNative={destIsNative}
        destAssetCode={destAssetCode}
        maxSendAmount={maxSendAmount}
        srcIsNative={srcIsNative}
        srcAssetCode={srcAssetCode}
        exactSendAmount={exactSendAmount}
        minReceiveAmount={minReceiveAmount}
        claimAssetKey={claimAssetKey}
        claimAmount={claimAmount}
        claimants={claimants}
        parsedInnerTxOps={parsedInnerTxOps}
        parsedInnerTxFee={parsedInnerTxFee}
        feeBumpBaseFee={feeBumpBaseFee}
        currentPublicKey={currentPublicKey}
        handleSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );

}
