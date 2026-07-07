// components/asset-creator/AssetCreatorPanel.tsx
"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings } from "@/lib/settings";
import { shortAddr } from "@/lib/format";
import type { AssetCreatorForm, StepResult } from "@/lib/asset-creator/types";
import { Step1Accounts } from "./steps/Step1Accounts";
import { Step2AssetConfig } from "./steps/Step2AssetConfig";
import { Step3Preflight } from "./steps/Step3Preflight";
import { Step4Result } from "./steps/Step4Result";

const EMPTY_FORM: AssetCreatorForm = {
  network: "public",
  issuerPublicKey: "",
  issuerSecretKey: "",
  distributorPublicKey: "",
  distributorSecretKey: "",
  resolvedFundingSecretKey: "",
  assetCode: "",
  tokenName: "",
  supply: 1_000_000,
  memo: "",
  homeDomain: "",
};

const STEPS = ["accounts", "config", "preflight", "result"] as const;
type Step = (typeof STEPS)[number];

export function AssetCreatorPanel() {
  const { activeWallet } = useActiveWallet();
  const { createGroup, upsertMember } = useAssetGroups();
  const { settings } = useSettings();
  const network = settings.network;

  const [step, setStep] = useState<Step>("accounts");
  const [form, setForm] = useState<AssetCreatorForm>({ ...EMPTY_FORM, network });
  const [results, setResults] = useState<StepResult[]>([]);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  // Keep resolvedFundingSecretKey + network in sync with live global state
  // (handles cross-tab wallet disconnect, and a network change elsewhere in
  // the app while sitting on a later wizard step)
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      network,
      resolvedFundingSecretKey: activeWallet?.secretKey ?? (prev.resolvedFundingSecretKey || ""),
    }));
  }, [activeWallet, network]);

  const onChange = (patch: Partial<AssetCreatorForm>) => {
    setForm((prev) => ({
      ...prev,
      ...patch,
      network, // network always from global settings
      resolvedFundingSecretKey: activeWallet?.secretKey ?? patch.resolvedFundingSecretKey ?? prev.resolvedFundingSecretKey,
    }));

    // Changing the identity fields invalidates any previously-completed
    // steps — those were completed for a different issuer/distributor/asset.
    if (
      patch.issuerPublicKey !== undefined ||
      patch.distributorPublicKey !== undefined ||
      patch.assetCode !== undefined
    ) {
      setCompletedSteps(new Set());
    }
  };

  const handleComplete = async (stepResults: StepResult[]) => {
    // Merge by stepId instead of a flat replace — a retry run only covers
    // the previously-failed steps, so earlier genuinely-succeeded results
    // (and their tx-hash links) must not disappear from the UI.
    setResults((prev) => {
      const merged = new Map(prev.map((r) => [r.stepId, r] as const));
      for (const r of stepResults) {
        merged.set(r.stepId, r);
      }
      return Array.from(merged.values());
    });
    setStep("result");

    const succeeded = stepResults
      .filter((r) => r.status === "success" || r.status === "skipped")
      .map((r) => r.stepId);
    setCompletedSteps((prev) => new Set([...prev, ...succeeded]));

    // Auto-save to Asset Groups on full success (guard against an empty
    // stepResults array vacuously satisfying .every())
    const allSucceeded =
      stepResults.length > 0 &&
      stepResults.every((r) => r.status === "success" || r.status === "skipped");
    if (allSucceeded && form.assetCode && form.issuerPublicKey) {
      const gId = createGroup({
        name: `${form.assetCode} Asset`,
        assetCode: form.assetCode,
        issuer: form.issuerPublicKey,
        network: form.network,
      });
      upsertMember(gId, {
        address: form.issuerPublicKey,
        role: "issuer",
        label: "Issuer",
        homeDomain: form.homeDomain || undefined,
      });
      upsertMember(gId, {
        address: form.distributorPublicKey,
        role: "distributor",
        label: "Distributor",
      });
      setGroupId(gId);
    }
  };

  const handleRetry = (_failedStepIds: string[]) => {
    // completedSteps already tracks what succeeded — Step3Preflight reads it via prop
    setStep("preflight");
  };

  const handleStartOver = () => {
    setForm({ ...EMPTY_FORM, network });
    setResults([]);
    setGroupId(undefined);
    setCompletedSteps(new Set());
    setStep("accounts");
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <Card>
      <CardContent className="pt-6">
        <Tabs value={step} onValueChange={(v) => setStep(v as Step)}>
          <TabsList className="mb-6 w-full grid grid-cols-4">
            {(["accounts", "config", "preflight", "result"] as const).map((s, i) => (
              <TabsTrigger
                key={s}
                value={s}
                disabled={step === "result" ? i !== stepIndex : i > stepIndex}
                className="capitalize"
              >
                {i + 1}. {s === "accounts" ? "Accounts" : s === "config" ? "Asset Config" : s === "preflight" ? "Preflight" : "Result"}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="accounts">
            <Step1Accounts
              form={form}
              onChange={onChange}
              activeWalletName={activeWallet?.name}
              activeWalletKey={activeWallet ? shortAddr(activeWallet.publicKey) : undefined}
              onNext={() => setStep("config")}
            />
          </TabsContent>

          <TabsContent value="config">
            <Step2AssetConfig
              form={form}
              onChange={onChange}
              onBack={() => setStep("accounts")}
              onNext={() => setStep("preflight")}
            />
          </TabsContent>

          <TabsContent value="preflight">
            <Step3Preflight
              form={form}
              completedSteps={completedSteps}
              onBack={() => setStep("config")}
              onComplete={handleComplete}
            />
          </TabsContent>

          <TabsContent value="result">
            <Step4Result
              results={results}
              groupId={groupId}
              network={form.network}
              issuerPublicKey={form.issuerPublicKey}
              distributorPublicKey={form.distributorPublicKey}
              onRetry={handleRetry}
              onStartOver={handleStartOver}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
