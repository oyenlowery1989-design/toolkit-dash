// components/asset-creator/AssetCreatorPanel.tsx
"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useAssetGroups } from "@/hooks/use-asset-groups";
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

  const [step, setStep] = useState<Step>("accounts");
  const [form, setForm] = useState<AssetCreatorForm>(EMPTY_FORM);
  const [results, setResults] = useState<StepResult[]>([]);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const onChange = (patch: Partial<AssetCreatorForm>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Always resolve funding key from active wallet if connected
      if (activeWallet?.secretKey) {
        next.resolvedFundingSecretKey = activeWallet.secretKey;
      }
      return next;
    });
  };

  const handleComplete = async (stepResults: StepResult[]) => {
    setResults(stepResults);
    setStep("result");

    const succeeded = new Set(
      stepResults.filter((r) => r.status === "success").map((r) => r.stepId)
    );
    setCompletedSteps(succeeded);

    // Auto-save to Asset Groups on full success
    const allSucceeded = stepResults.every(
      (r) => r.status === "success" || r.status === "skipped"
    );
    if (allSucceeded && form.assetCode && form.issuerPublicKey) {
      const gId = createGroup({
        name: `${form.assetCode.toUpperCase()} Asset`,
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
    setForm(EMPTY_FORM);
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
                disabled={i > stepIndex && step !== "result"}
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
              onRetry={handleRetry}
              onStartOver={handleStartOver}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
