"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { WalletSelect } from "@/components/ui/wallet-select";
import { shortAddr } from "@/lib/format";
import { StrKey } from "stellar-sdk";

import { FlagsTab } from "./FlagsTab";
import { HoldersTab } from "./HoldersTab";
import { TradesTab } from "./TradesTab";

export function AssetManagerPanel() {
  const { groups } = useAssetGroups();
  const { activeWallet } = useActiveWallet();


  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const [tab, setTab] = useState("flags");

  const issuerAddress = issuer.trim();
  const isReady =
    assetCode.trim().length > 0 &&
    StrKey.isValidEd25519PublicKey(issuerAddress);

  const effectiveSecretKey = activeWallet?.secretKey ?? secretKey.trim();

  function handleLoadFromGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.assetCode) setAssetCode(group.assetCode);
    if (group.issuer) setIssuer(group.issuer);
  }

  function handleClear() {
    setAssetCode("");
    setIssuer("");
    setSecretKey("");
    setTab("flags");
  }

  return (
    <div className="space-y-4">
      {/* Shared asset input — persists across all tabs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Asset</CardTitle>
              <CardDescription>
                Entered once — shared across all tabs.
              </CardDescription>
            </div>
            {isReady && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="shrink-0 gap-1.5 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.length > 0 && (
            <div>
              <Label className="text-xs">Load from Asset Group</Label>
              <Select
                value=""
                onValueChange={handleLoadFromGroup}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a group…" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                      {g.assetCode ? ` (${g.assetCode})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="panel-code">Asset Code</Label>
              <Input
                id="panel-code"
                placeholder="e.g. MYTOKEN"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="panel-issuer">Issuer Address</Label>
              <Input
                id="panel-issuer"
                placeholder="G…"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          {/* Secret key — shown when no wallet connected */}
          {activeWallet ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Signing with:</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-500">
                {activeWallet.name} · {shortAddr(activeWallet.publicKey)}
              </span>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="panel-sk">
                  Issuer Secret Key{" "}
                  <span className="text-muted-foreground text-xs">(optional — write actions only)</span>
                </Label>
                <WalletSelect
                  currentValue={secretKey}
                  onPick={(w) => setSecretKey(w.secretKey)}
                />
              </div>
              <Input
                id="panel-sk"
                type="password"
                placeholder="S…"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs — only render when asset is ready */}
      {isReady ? (
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="flags">Asset Flags</TabsTrigger>
            <TabsTrigger value="holders">Holders</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
          </TabsList>
          <TabsContent value="flags">
            <FlagsTab
              issuer={issuerAddress}
              secretKey={effectiveSecretKey}
              isWalletConnected={!!activeWallet}
            />
          </TabsContent>
          <TabsContent value="holders">
            <HoldersTab
              assetCode={assetCode.trim()}
              issuer={issuerAddress}
              secretKey={effectiveSecretKey}
            />
          </TabsContent>
          <TabsContent value="trades">
            <TradesTab
              assetCode={assetCode.trim()}
              issuer={issuerAddress}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">
          Enter an asset code and issuer address above to get started.
        </p>
      )}
    </div>
  );
}
