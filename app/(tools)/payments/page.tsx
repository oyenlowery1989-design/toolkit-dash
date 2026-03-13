"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  StrKey,
} from "stellar-sdk";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Send,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  BookUser,
  Plus,
  Trash2,
  Route,
} from "lucide-react";
import { toast } from "sonner";
import {
  useSettings,
  NETWORK_LABELS,
  resolveHorizonUrl,
  resolveNetworkPassphrase,
} from "@/lib/settings";
import type { Network } from "@/lib/settings";
import { getErrorMessage, shortKey } from "@/lib/stellar-helpers";
import { useAddressBook } from "@/hooks/use-address-book";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TxStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "success"
  | "error";
type MemoType = "none" | "text" | "id" | "hash" | "return";
type PaymentTab = "xlm" | "token" | "path";

interface PathRecord {
  id: string;
  sourceAssetType: string;
  sourceAssetCode?: string;
  sourceAssetIssuer?: string;
  sourceAmount: string;
  destinationAssetType: string;
  destinationAssetCode?: string;
  destinationAssetIssuer?: string;
  destinationAmount: string;
  path: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAsset(code: string, issuer: string): Asset {
  if (code.toUpperCase() === "XLM" && !issuer) return Asset.native();
  return new Asset(code, issuer);
}

function buildMemo(type: MemoType, value: string): Memo {
  switch (type) {
    case "text":
      return Memo.text(value);
    case "id":
      return Memo.id(value);
    case "hash":
      return Memo.hash(value);
    case "return":
      return Memo.return(value);
    default:
      return Memo.none();
  }
}

function pathAssetLabel(assetType: string, code?: string): string {
  if (assetType === "native") return "XLM";
  return code ?? "unknown";
}

function isValidAssetCode(code: string): boolean {
  return /^[a-zA-Z0-9]{1,12}$/.test(code);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PaymentsPage() {
  // -- Tab state
  const [activeTab, setActiveTab] = useState<PaymentTab>("xlm");

  // -- Common form fields
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  // -- Token fields
  const [assetCode, setAssetCode] = useState("");
  const [assetIssuer, setAssetIssuer] = useState("");

  // -- Path payment fields
  const [srcIsNative, setSrcIsNative] = useState(true);
  const [srcAssetCode, setSrcAssetCode] = useState("");
  const [srcAssetIssuer, setSrcAssetIssuer] = useState("");
  const [maxSendAmount, setMaxSendAmount] = useState("");
  const [destIsNative, setDestIsNative] = useState(true);
  const [destAssetCode, setDestAssetCode] = useState("");
  const [destAssetIssuer, setDestAssetIssuer] = useState("");
  const [destAmount, setDestAmount] = useState("");
  const [pathDest, setPathDest] = useState("");
  const [paths, setPaths] = useState<PathRecord[]>([]);
  const [selectedPathIndex, setSelectedPathIndex] = useState<number | null>(
    null,
  );
  const [isFindingPaths, setIsFindingPaths] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  // -- Memo
  const [memoType, setMemoType] = useState<MemoType>("none");
  const [memoValue, setMemoValue] = useState("");

  // -- Fee
  const [fee, setFee] = useState("100");

  // -- Network (global)
  const { settings } = useSettings();
  const network = settings.network;

  // -- Address book
  const { entries: addressBookEntries, setEntries: setAddressBookEntries } =
    useAddressBook();
  const [addressBookOpen, setAddressBookOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");

  // -- Secret key (security: stored in ref, not state)
  const secretKeyRef = useRef<string>("");
  const [secretKeyDisplay, setSecretKeyDisplay] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // -- Transaction status
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // -- Confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);

  // -- Clipboard feedback
  const [copied, setCopied] = useState(false);

  // -- Cleanup secret on unmount
  useEffect(() => {
    return () => {
      secretKeyRef.current = "";
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function isFormValid(): boolean {
    if (activeTab === "xlm") {
      return (
        StrKey.isValidEd25519PublicKey(destination.trim()) && Number(amount) > 0
      );
    }
    if (activeTab === "token") {
      return (
        StrKey.isValidEd25519PublicKey(destination.trim()) &&
        Number(amount) > 0 &&
        isValidAssetCode(assetCode.trim()) &&
        StrKey.isValidEd25519PublicKey(assetIssuer.trim())
      );
    }
    // path
    const srcValid =
      srcIsNative ||
      (isValidAssetCode(srcAssetCode.trim()) &&
        StrKey.isValidEd25519PublicKey(srcAssetIssuer.trim()));
    const destValid =
      destIsNative ||
      (isValidAssetCode(destAssetCode.trim()) &&
        StrKey.isValidEd25519PublicKey(destAssetIssuer.trim()));
    return (
      StrKey.isValidEd25519PublicKey(pathDest.trim()) &&
      Number(destAmount) > 0 &&
      Number(maxSendAmount) > 0 &&
      srcValid &&
      destValid &&
      selectedPathIndex !== null
    );
  }

  // ---------------------------------------------------------------------------
  // Path finding
  // ---------------------------------------------------------------------------

  const handleFindPaths = useCallback(async () => {
    setPaths([]);
    setSelectedPathIndex(null);
    setPathError(null);

    const destAcct = pathDest.trim();
    if (!StrKey.isValidEd25519PublicKey(destAcct)) {
      setPathError("Invalid destination account.");
      return;
    }
    if (Number(destAmount) <= 0) {
      setPathError("Destination amount must be greater than 0.");
      return;
    }

    const srcAsset = srcIsNative
      ? Asset.native()
      : isValidAssetCode(srcAssetCode.trim()) &&
          StrKey.isValidEd25519PublicKey(srcAssetIssuer.trim())
        ? new Asset(srcAssetCode.trim(), srcAssetIssuer.trim())
        : null;
    const dstAsset = destIsNative
      ? Asset.native()
      : isValidAssetCode(destAssetCode.trim()) &&
          StrKey.isValidEd25519PublicKey(destAssetIssuer.trim())
        ? new Asset(destAssetCode.trim(), destAssetIssuer.trim())
        : null;

    if (!srcAsset) {
      setPathError("Invalid source asset configuration.");
      return;
    }
    if (!dstAsset) {
      setPathError("Invalid destination asset configuration.");
      return;
    }

    setIsFindingPaths(true);
    try {
      const server = new Horizon.Server(resolveHorizonUrl(settings));
      const result = await server
        .strictReceivePaths([srcAsset], dstAsset, destAmount)
        .call();

      const mapped: PathRecord[] = (result.records as any[]).map(
        (r: any, i: number) => ({
          id: String(i),
          sourceAssetType: r.source_asset_type,
          sourceAssetCode: r.source_asset_code,
          sourceAssetIssuer: r.source_asset_issuer,
          sourceAmount: r.source_amount,
          destinationAssetType: r.destination_asset_type,
          destinationAssetCode: r.destination_asset_code,
          destinationAssetIssuer: r.destination_asset_issuer,
          destinationAmount: r.destination_amount,
          path: r.path ?? [],
        }),
      );

      setPaths(mapped);
      if (mapped.length === 0) {
        setPathError("No paths found for this pair and amount.");
      }
    } catch (e) {
      setPathError(getErrorMessage(e));
    } finally {
      setIsFindingPaths(false);
    }
  }, [
    settings,
    pathDest,
    destAmount,
    srcIsNative,
    srcAssetCode,
    srcAssetIssuer,
    destIsNative,
    destAssetCode,
    destAssetIssuer,
  ]);

  // ---------------------------------------------------------------------------
  // Address book helpers
  // ---------------------------------------------------------------------------

  function handleAddAddress() {
    const label = newLabel.trim();
    const key = newKey.trim();
    if (!label || !StrKey.isValidEd25519PublicKey(key)) return;
    setAddressBookEntries([...addressBookEntries, { label, publicKey: key }]);
    setNewLabel("");
    setNewKey("");
  }

  function handleRemoveAddress(index: number) {
    const next = addressBookEntries.filter((_, i) => i !== index);
    setAddressBookEntries(next);
  }

  function handleSelectAddress(publicKey: string) {
    if (activeTab === "path") {
      setPathDest(publicKey);
    } else {
      setDestination(publicKey);
    }
  }

  // ---------------------------------------------------------------------------
  // Confirm & Submit
  // ---------------------------------------------------------------------------

  function handleOpenConfirm() {
    if (!isFormValid()) return;
    if (!secretKeyRef.current.trim()) {
      toast.error("Please enter your secret key.");
      return;
    }
    setConfirmOpen(true);
  }

  function getConfirmationSummary() {
    const dest = activeTab === "path" ? pathDest.trim() : destination.trim();
    let assetDisplay = "XLM";
    let amountDisplay = amount;

    if (activeTab === "token") {
      assetDisplay = assetCode.trim();
      amountDisplay = amount;
    } else if (activeTab === "path") {
      assetDisplay = destIsNative ? "XLM" : destAssetCode.trim();
      amountDisplay = destAmount;
    }

    return { dest, assetDisplay, amountDisplay };
  }

  async function handleSubmit() {
    setConfirmOpen(false);
    setTxStatus("building");
    setTxHash(null);
    setTxError(null);

    try {
      // 1. Derive keypair
      const keypair = Keypair.fromSecret(secretKeyRef.current.trim());
      const publicKey = keypair.publicKey();

      // 2. Load account

      const server = new Horizon.Server(resolveHorizonUrl(settings));
      const account = await server.loadAccount(publicKey);

      // 3. Build transaction
      setTxStatus("signing");
      const networkPassphrase = resolveNetworkPassphrase(network);
      const builder = new TransactionBuilder(account, {
        fee,
        networkPassphrase,
      });

      // 4. Add operation
      if (activeTab === "xlm") {
        builder.addOperation(
          Operation.payment({
            destination: destination.trim(),
            asset: Asset.native(),
            amount,
          }),
        );
      } else if (activeTab === "token") {
        builder.addOperation(
          Operation.payment({
            destination: destination.trim(),
            asset: new Asset(assetCode.trim(), assetIssuer.trim()),
            amount,
          }),
        );
      } else if (activeTab === "path") {
        const selectedPath = paths[selectedPathIndex!];
        const sendAsset = srcIsNative
          ? Asset.native()
          : new Asset(srcAssetCode.trim(), srcAssetIssuer.trim());
        const receiveAsset = destIsNative
          ? Asset.native()
          : new Asset(destAssetCode.trim(), destAssetIssuer.trim());

        const intermediaryPath = selectedPath.path.map((p) =>
          p.asset_type === "native"
            ? Asset.native()
            : new Asset(p.asset_code!, p.asset_issuer!),
        );

        builder.addOperation(
          Operation.pathPaymentStrictReceive({
            sendAsset,
            sendMax: maxSendAmount,
            destination: pathDest.trim(),
            destAsset: receiveAsset,
            destAmount,
            path: intermediaryPath,
          }),
        );
      }

      // 5. Add memo
      if (memoType !== "none" && memoValue.trim()) {
        builder.addMemo(buildMemo(memoType, memoValue.trim()));
      }

      // 6. Build & sign
      const tx = builder.setTimeout(30).build();
      tx.sign(keypair);

      // 7. IMMEDIATELY clear the secret key
      secretKeyRef.current = "";
      setSecretKeyDisplay("");
      setShowSecret(false);

      // 8. Submit
      setTxStatus("submitting");
      const result = await server.submitTransaction(tx);
      const hash = (result as any).hash ?? (result as any).id ?? "unknown";

      setTxHash(hash);
      setTxStatus("success");
      toast.success("Transaction submitted successfully!");
    } catch (e) {
      // Also clear secret key on error
      secretKeyRef.current = "";
      setSecretKeyDisplay("");
      setShowSecret(false);

      setTxError(getErrorMessage(e));
      setTxStatus("error");
      toast.error("Transaction failed: " + getErrorMessage(e));
    }
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  function handleReset() {
    setDestination("");
    setAmount("");
    setAssetCode("");
    setAssetIssuer("");
    setSrcIsNative(true);
    setSrcAssetCode("");
    setSrcAssetIssuer("");
    setMaxSendAmount("");
    setDestIsNative(true);
    setDestAssetCode("");
    setDestAssetIssuer("");
    setDestAmount("");
    setPathDest("");
    setPaths([]);
    setSelectedPathIndex(null);
    setPathError(null);
    setMemoType("none");
    setMemoValue("");
    setFee("100");
    setSecretKeyDisplay("");
    secretKeyRef.current = "";
    setShowSecret(false);
    setTxStatus("idle");
    setTxHash(null);
    setTxError(null);
    setCopied(false);
  }

  // ---------------------------------------------------------------------------
  // Copy to clipboard
  // ---------------------------------------------------------------------------

  async function handleCopyHash() {
    if (!txHash) return;
    await navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---------------------------------------------------------------------------
  // Secret key handler
  // ---------------------------------------------------------------------------

  function handleSecretKeyChange(val: string) {
    secretKeyRef.current = val;
    setSecretKeyDisplay(val);
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const isSubmitting =
    txStatus === "building" ||
    txStatus === "signing" ||
    txStatus === "submitting";
  const formValid = isFormValid();
  const summary = getConfirmationSummary();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // -- Success state
  if (txStatus === "success" && txHash) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground mt-2">
            Send XLM, tokens, and path payments on the Stellar network.
          </p>
        </div>

        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-5 w-5" />
              Transaction Submitted
            </CardTitle>
            <CardDescription>
              Your transaction was signed and submitted to the{" "}
              {NETWORK_LABELS[network]}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Transaction Hash
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                  {txHash}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyHash}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleReset} className="w-full sm:w-auto">
              <Send className="mr-2 h-4 w-4" />
              Send Another
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        <p className="text-muted-foreground mt-2">
          Send XLM, tokens, and path payments on the Stellar network.
        </p>
      </div>

      {/* ================================================================== */}
      {/* Payment Tabs                                                       */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle>New Payment</CardTitle>
          <CardDescription>
            Choose a payment type and fill in the details below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as PaymentTab)}
          >
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="xlm">Send XLM</TabsTrigger>
              <TabsTrigger value="token">Send Token</TabsTrigger>
              <TabsTrigger value="path">Path Payment</TabsTrigger>
            </TabsList>

            {/* ---- Tab 1: Send XLM ---- */}
            <TabsContent value="xlm" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="xlm-dest">Destination Account</Label>
                <Input
                  id="xlm-dest"
                  placeholder="G..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="font-mono text-sm"
                />
                {destination.trim() &&
                  !StrKey.isValidEd25519PublicKey(destination.trim()) && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Invalid Stellar public key.
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="xlm-amount">Amount (XLM)</Label>
                <Input
                  id="xlm-amount"
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {amount && Number(amount) <= 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Amount must be greater than 0.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* ---- Tab 2: Send Token ---- */}
            <TabsContent value="token" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="token-dest">Destination Account</Label>
                <Input
                  id="token-dest"
                  placeholder="G..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="font-mono text-sm"
                />
                {destination.trim() &&
                  !StrKey.isValidEd25519PublicKey(destination.trim()) && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Invalid Stellar public key.
                    </p>
                  )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="token-code">Asset Code</Label>
                  <Input
                    id="token-code"
                    placeholder="USDC"
                    maxLength={12}
                    value={assetCode}
                    onChange={(e) => setAssetCode(e.target.value)}
                  />
                  {assetCode.trim() && !isValidAssetCode(assetCode.trim()) && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      1-12 alphanumeric characters.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="token-issuer">Asset Issuer</Label>
                  <Input
                    id="token-issuer"
                    placeholder="G..."
                    value={assetIssuer}
                    onChange={(e) => setAssetIssuer(e.target.value)}
                    className="font-mono text-sm"
                  />
                  {assetIssuer.trim() &&
                    !StrKey.isValidEd25519PublicKey(assetIssuer.trim()) && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Invalid issuer public key.
                      </p>
                    )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-amount">Amount</Label>
                <Input
                  id="token-amount"
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {amount && Number(amount) <= 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Amount must be greater than 0.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* ---- Tab 3: Path Payment ---- */}
            <TabsContent value="path" className="space-y-4 mt-4">
              {/* Source asset */}
              <fieldset className="space-y-3 rounded-md border border-border p-4">
                <legend className="px-2 text-sm font-medium text-muted-foreground">
                  Source Asset
                </legend>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="src-native"
                    checked={srcIsNative}
                    onChange={(e) => setSrcIsNative(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label
                    htmlFor="src-native"
                    className="text-sm cursor-pointer"
                  >
                    Native (XLM)
                  </Label>
                </div>
                {!srcIsNative && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="src-code">Asset Code</Label>
                      <Input
                        id="src-code"
                        placeholder="USDC"
                        maxLength={12}
                        value={srcAssetCode}
                        onChange={(e) => setSrcAssetCode(e.target.value)}
                      />
                      {srcAssetCode.trim() &&
                        !isValidAssetCode(srcAssetCode.trim()) && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            1-12 alphanumeric characters.
                          </p>
                        )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="src-issuer">Asset Issuer</Label>
                      <Input
                        id="src-issuer"
                        placeholder="G..."
                        value={srcAssetIssuer}
                        onChange={(e) => setSrcAssetIssuer(e.target.value)}
                        className="font-mono text-sm"
                      />
                      {srcAssetIssuer.trim() &&
                        !StrKey.isValidEd25519PublicKey(
                          srcAssetIssuer.trim(),
                        ) && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Invalid issuer public key.
                          </p>
                        )}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="max-send">Max Send Amount</Label>
                  <Input
                    id="max-send"
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="any"
                    value={maxSendAmount}
                    onChange={(e) => setMaxSendAmount(e.target.value)}
                  />
                </div>
              </fieldset>

              {/* Destination asset */}
              <fieldset className="space-y-3 rounded-md border border-border p-4">
                <legend className="px-2 text-sm font-medium text-muted-foreground">
                  Destination Asset
                </legend>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="dest-native"
                    checked={destIsNative}
                    onChange={(e) => setDestIsNative(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label
                    htmlFor="dest-native"
                    className="text-sm cursor-pointer"
                  >
                    Native (XLM)
                  </Label>
                </div>
                {!destIsNative && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="dest-code">Asset Code</Label>
                      <Input
                        id="dest-code"
                        placeholder="USDC"
                        maxLength={12}
                        value={destAssetCode}
                        onChange={(e) => setDestAssetCode(e.target.value)}
                      />
                      {destAssetCode.trim() &&
                        !isValidAssetCode(destAssetCode.trim()) && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            1-12 alphanumeric characters.
                          </p>
                        )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dest-issuer">Asset Issuer</Label>
                      <Input
                        id="dest-issuer"
                        placeholder="G..."
                        value={destAssetIssuer}
                        onChange={(e) => setDestAssetIssuer(e.target.value)}
                        className="font-mono text-sm"
                      />
                      {destAssetIssuer.trim() &&
                        !StrKey.isValidEd25519PublicKey(
                          destAssetIssuer.trim(),
                        ) && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Invalid issuer public key.
                          </p>
                        )}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="dest-amount">Destination Amount</Label>
                  <Input
                    id="dest-amount"
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="any"
                    value={destAmount}
                    onChange={(e) => setDestAmount(e.target.value)}
                  />
                </div>
              </fieldset>

              {/* Destination account */}
              <div className="space-y-2">
                <Label htmlFor="path-dest">Destination Account</Label>
                <Input
                  id="path-dest"
                  placeholder="G..."
                  value={pathDest}
                  onChange={(e) => setPathDest(e.target.value)}
                  className="font-mono text-sm"
                />
                {pathDest.trim() &&
                  !StrKey.isValidEd25519PublicKey(pathDest.trim()) && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Invalid Stellar public key.
                    </p>
                  )}
              </div>

              {/* Find paths */}
              <Button
                onClick={handleFindPaths}
                disabled={isFindingPaths}
                variant="outline"
                className="w-full"
              >
                {isFindingPaths ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Route className="mr-2 h-4 w-4" />
                )}
                Find Paths
              </Button>

              {pathError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {pathError}
                </p>
              )}

              {/* Path results */}
              {paths.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Available Paths ({paths.length})
                  </Label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {paths.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPathIndex(i)}
                        className={`w-full text-left rounded-md border p-3 transition-colors ${
                          selectedPathIndex === i
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div
                              className={`h-3 w-3 rounded-full border-2 ${
                                selectedPathIndex === i
                                  ? "border-primary bg-primary"
                                  : "border-muted-foreground"
                              }`}
                            />
                            <span className="font-mono font-medium">
                              {p.sourceAmount}{" "}
                              {pathAssetLabel(
                                p.sourceAssetType,
                                p.sourceAssetCode,
                              )}
                            </span>
                            <span className="text-muted-foreground">-&gt;</span>
                            <span className="font-mono font-medium">
                              {p.destinationAmount}{" "}
                              {pathAssetLabel(
                                p.destinationAssetType,
                                p.destinationAssetCode,
                              )}
                            </span>
                          </div>
                        </div>
                        {p.path.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground ml-5">
                            via{" "}
                            {p.path
                              .map((hop) =>
                                pathAssetLabel(hop.asset_type, hop.asset_code),
                              )
                              .join(" -> ")}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Memo Section                                                       */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Memo</CardTitle>
          <CardDescription>
            Optional memo to attach to this transaction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Memo Type</Label>
              <Select
                value={memoType}
                onValueChange={(v) => setMemoType(v as MemoType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="id">ID</SelectItem>
                  <SelectItem value="hash">Hash</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {memoType !== "none" && (
              <div className="space-y-2">
                <Label htmlFor="memo-value">
                  Memo Value
                  {memoType === "text" && (
                    <span className="text-muted-foreground ml-1">
                      (max 28 bytes)
                    </span>
                  )}
                  {memoType === "id" && (
                    <span className="text-muted-foreground ml-1">
                      (unsigned 64-bit integer)
                    </span>
                  )}
                  {(memoType === "hash" || memoType === "return") && (
                    <span className="text-muted-foreground ml-1">
                      (64-char hex)
                    </span>
                  )}
                </Label>
                <Input
                  id="memo-value"
                  placeholder={
                    memoType === "text"
                      ? "Enter memo text..."
                      : memoType === "id"
                        ? "12345"
                        : "64-character hex string..."
                  }
                  value={memoValue}
                  onChange={(e) => setMemoValue(e.target.value)}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Fee Section                                                        */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction Fee</CardTitle>
          <CardDescription>
            Base fee in stroops (1 XLM = 10,000,000 stroops). Default is 100.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="fee">Fee (stroops)</Label>
            <Input
              id="fee"
              type="number"
              min="100"
              step="1"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Network Selector                                                   */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Network</CardTitle>
          <CardDescription>
            Select which Stellar network to submit the transaction to.
          </CardDescription>
        </CardHeader>
        <CardContent></CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Address Book                                                       */}
      {/* ================================================================== */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setAddressBookOpen(!addressBookOpen)}
        >
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <BookUser className="h-4 w-4" />
              Address Book
            </span>
            {addressBookOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </CardTitle>
          <CardDescription>
            Save and manage frequently used addresses.
          </CardDescription>
        </CardHeader>
        {addressBookOpen && (
          <CardContent className="space-y-4">
            {/* Saved addresses */}
            {addressBookEntries.length > 0 ? (
              <div className="space-y-2">
                {addressBookEntries.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => handleSelectAddress(entry.publicKey)}
                    >
                      <div className="text-sm font-medium">{entry.label}</div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {shortKey(entry.publicKey)}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveAddress(i)}
                      className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                No saved addresses yet.
              </p>
            )}

            {/* Add new address */}
            <div className="border-t border-border pt-4 space-y-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                Add New Address
              </Label>
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  placeholder="Label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <Input
                  placeholder="G..."
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleAddAddress}
                  disabled={
                    !newLabel.trim() ||
                    !StrKey.isValidEd25519PublicKey(newKey.trim())
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {newKey.trim() &&
                !StrKey.isValidEd25519PublicKey(newKey.trim()) && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Invalid Stellar public key.
                  </p>
                )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ================================================================== */}
      {/* Signing Section (only when form is valid)                          */}
      {/* ================================================================== */}
      {formValid && (
        <>
          {/* Security warning */}
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Security Warnings
                  </p>
                  <ul className="text-xs text-amber-700/80 dark:text-amber-300/80 space-y-1 list-disc list-inside">
                    <li>Your secret key gives full control of your account</li>
                    <li>This tool never stores your key</li>
                    <li>Verify the destination address carefully</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Secret key input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sign Transaction</CardTitle>
              <CardDescription>
                Enter your secret key to sign and submit. It is never stored.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="secret-key">Secret Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="secret-key"
                    type={showSecret ? "text" : "password"}
                    placeholder="S..."
                    value={secretKeyDisplay}
                    onChange={(e) => handleSecretKeyChange(e.target.value)}
                    className="font-mono text-sm flex-1"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="shrink-0"
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleOpenConfirm}
                disabled={isSubmitting || !secretKeyDisplay.trim()}
                className="w-full sm:w-auto"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {txStatus === "building"
                  ? "Building..."
                  : txStatus === "signing"
                    ? "Signing..."
                    : txStatus === "submitting"
                      ? "Submitting..."
                      : "Sign & Submit"}
              </Button>
            </CardFooter>
          </Card>
        </>
      )}

      {/* ================================================================== */}
      {/* Error display                                                      */}
      {/* ================================================================== */}
      {txStatus === "error" && txError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex items-start gap-3 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Transaction Failed</p>
              <p className="text-xs">{txError}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================== */}
      {/* Confirmation Dialog                                                */}
      {/* ================================================================== */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Transaction</DialogTitle>
            <DialogDescription>
              Please review the transaction details before submitting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Destination:</span>
              <span className="font-mono text-xs break-all">
                {summary.dest}
              </span>

              <span className="text-muted-foreground">Amount:</span>
              <span className="font-mono">
                {summary.amountDisplay} {summary.assetDisplay}
              </span>

              {activeTab === "path" &&
                selectedPathIndex !== null &&
                paths[selectedPathIndex] && (
                  <>
                    <span className="text-muted-foreground">Max Send:</span>
                    <span className="font-mono">
                      {maxSendAmount}{" "}
                      {srcIsNative ? "XLM" : srcAssetCode.trim()}
                    </span>
                  </>
                )}

              <span className="text-muted-foreground">Fee:</span>
              <span className="font-mono">{fee} stroops</span>

              <span className="text-muted-foreground">Network:</span>
              <span>{NETWORK_LABELS[network]}</span>

              {memoType !== "none" && memoValue.trim() && (
                <>
                  <span className="text-muted-foreground">Memo:</span>
                  <span className="font-mono text-xs break-all">
                    ({memoType}) {memoValue.trim()}
                  </span>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              <Send className="mr-2 h-4 w-4" />
              Confirm &amp; Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
