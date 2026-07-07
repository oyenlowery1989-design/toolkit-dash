"use client";

// AccountFunderPanel.tsx
//
// Bulk Stellar account creator with a clear parent/child hierarchy:
//
//   Parent = the wallet that funds/sponsors all children.
//          Can be an existing saved wallet OR a freshly generated keypair.
//
//   Children = N new accounts created by the parent.
//
// Flow:
//   Step 1 — Choose or generate a parent account
//   Step 2 — Generate N child keypairs
//   Step 3 — Create children (Direct / Sponsored / Close tabs)
//   Step 4 — Save parent + all children to one Asset Group

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  Dispatch,
  SetStateAction,
} from "react";
import {
  Keypair,
  TransactionBuilder,
  Operation,
} from "stellar-sdk";
import * as StellarSdk from "stellar-sdk";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { WalletSelect } from "@/components/ui/wallet-select";
import { Switch } from "@/components/ui/switch";
import { ShortAddress } from "@/components/shared/ShortAddress";
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Wallet,
  UserPlus,
  Download,
  RefreshCw,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Shield,
  Trash2,
  RefreshCcw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useSettings,
  resolveHorizonUrl,
  resolveNetworkPassphrase,
} from "@/lib/settings";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useAssetGroups } from "@/hooks/use-asset-groups";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Status of each child account during the funding process
type FundStatus = "pending" | "funding" | "funded" | "failed";

// Status of each account during the close operation
type CloseStatus = "pending" | "closing" | "closed" | "failed";

// A generated child keypair with its current funding status
interface GeneratedAccount {
  publicKey: string;
  secretKey: string;
  status: FundStatus;
  error?: string; // Horizon result code if failed (e.g. "op_already_exists")
}

// ---------------------------------------------------------------------------
// Verification helper
//
// Stellar transactions are atomic — if a batch submission fails, NOTHING in
// it was committed to the ledger, even though Horizon's per-op result codes
// can still list "op_success" for ops that would have succeeded had the tx
// not aborted. The only way to know whether an address actually exists
// on-ledger after a failed submission is to ask Horizon directly.
// ---------------------------------------------------------------------------

async function verifyAmbiguousAccounts(
  addresses: string[],
  server: InstanceType<typeof StellarSdk.Horizon.Server>,
  setAccounts: Dispatch<SetStateAction<GeneratedAccount[]>>
) {
  for (const address of addresses) {
    let confirmed = false;
    try {
      await server.loadAccount(address);
      confirmed = true;
    } catch {
      confirmed = false;
    }
    setAccounts((prev) =>
      prev.map((a) =>
        a.publicKey === address
          ? confirmed
            ? { ...a, status: "funded" as FundStatus, error: undefined }
            : { ...a, status: "failed" as FundStatus, error: "unconfirmed on ledger" }
          : a
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * WalletPicker — folder-grouped wallet selector + manual secret key fallback.
 * Reused across multiple places (parent selection, close-tab sponsor picker).
 */
function WalletPicker({
  wallets,
  walletId,
  manualKey,
  showManual,
  onWalletChange,
  onManualKeyChange,
  onToggleShow,
  label,
  manualPlaceholder = "S...",
  network = "public",
}: {
  wallets: ReturnType<typeof useWalletsV2>["wallets"];
  walletId: string | null;
  manualKey: string;
  showManual: boolean;
  onWalletChange: (id: string | null) => void;
  onManualKeyChange: (val: string) => void;
  onToggleShow: () => void;
  label: string;
  manualPlaceholder?: string;
  network?: string;
}) {
  const selectedWallet = wallets.find((w) => w.id === walletId);

  return (
    <div className="space-y-3">
      {/* Wallet selector row */}
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <WalletSelect
          currentId={walletId ?? undefined}
          onPick={(w) => onWalletChange(w.id)}
          onClear={() => onWalletChange(null)}
          align="end"
        />
      </div>

      {/* Green chip — shown when a wallet is selected */}
      {selectedWallet && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
          <Wallet className="h-4 w-4 shrink-0 text-green-500" />
          <span className="flex-1 font-medium">{selectedWallet.name}</span>
          <span className="text-xs text-muted-foreground">
            <ShortAddress address={selectedWallet.publicKey} network={network} />
          </span>
        </div>
      )}

      {/* Manual secret key input — shown when no wallet is selected */}
      {!walletId && (
        <div className="space-y-2">
          {wallets.length === 0 && <Label>{label}</Label>}
          <div className="flex gap-2">
            <Input
              type={showManual ? "text" : "password"}
              placeholder={manualPlaceholder}
              value={manualKey}
              onChange={(e) => onManualKeyChange(e.target.value)}
              className="font-mono text-sm flex-1"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore
            />
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={onToggleShow}
              className="shrink-0"
            >
              {showManual ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AccountList — displays generated child accounts with status icons,
 * masked secret keys, per-key copy, and bulk actions (reveal all, copy all, CSV).
 */
function AccountList({
  accounts,
  revealAll,
  onToggleReveal,
  onCopyOne,
  onCopyAll,
  onDownloadCSV,
  copiedKey,
  copiedAll,
  labelPrefix = "Child",
  network = "public",
}: {
  accounts: GeneratedAccount[];
  revealAll: boolean;
  onToggleReveal: () => void;
  onCopyOne: (key: string) => void;
  onCopyAll: () => void;
  onDownloadCSV: () => void;
  copiedKey: string | null;
  copiedAll: boolean;
  labelPrefix?: string;
  network?: string;
}) {
  const funded = accounts.filter((a) => a.status === "funded");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Generated Children</CardTitle>
          <CardDescription>{funded.length}/{accounts.length} funded</CardDescription>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* Toggle secret key visibility for all rows */}
          <Button variant="ghost" size="sm" onClick={onToggleReveal} className="gap-1 text-xs">
            {revealAll ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {revealAll ? "Hide all" : "Reveal all"}
          </Button>
          {accounts.length > 0 && (
            <>
              {/* Copy public+secret for all accounts, tab-separated */}
              <Button variant="ghost" size="sm" onClick={onCopyAll} className="gap-1 text-xs">
                {copiedAll ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                Copy all
              </Button>
              {/* Download as CSV */}
              <Button variant="ghost" size="sm" onClick={onDownloadCSV} className="gap-1 text-xs">
                <Download className="h-3 w-3" />
                CSV
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {accounts.map((acc, i) => (
            <div
              key={acc.publicKey}
              className="rounded-md border px-3 py-2 text-xs font-mono space-y-1"
            >
              {/* Row header: status icon + label + address + copy button */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Status dot / spinner / check / cross */}
                  {acc.status === "pending" && (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                  )}
                  {acc.status === "funding" && (
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                  )}
                  {acc.status === "funded" && (
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  )}
                  {acc.status === "failed" && (
                    <XCircle className="h-3 w-3 text-destructive shrink-0" />
                  )}
                  {/* Child label (Child 1, Child 2, etc.) */}
                  <span className="text-muted-foreground">{labelPrefix} {i + 1}</span>
                  {/* Short address always visible */}
                  <span className="truncate">
                    <ShortAddress address={acc.publicKey} network={network} />
                  </span>
                  {/* Full address only on wider screens */}
                  <span className="hidden sm:block truncate text-muted-foreground/60">
                    {acc.publicKey}
                  </span>
                </div>
                {/* Copy public key */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => onCopyOne(acc.publicKey)}
                >
                  {copiedKey === acc.publicKey ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>

              {/* Secret key row — masked until "Reveal all" */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60 shrink-0">secret:</span>
                <span className="truncate">
                  {revealAll
                    ? acc.secretKey
                    : acc.secretKey.slice(0, 4) +
                      "••••••••••••••••••••••••••••••••••••••••••••" +
                      acc.secretKey.slice(-4)}
                </span>
                {/* Copy secret key */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => onCopyOne(acc.secretKey)}
                >
                  {copiedKey === acc.secretKey ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>

              {/* Error detail if funding failed */}
              {acc.status === "failed" && acc.error && (
                <div className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  {acc.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * SaveToGroup — saves parent + all funded children to a single Asset Group.
 *
 * Parent is saved with role "bank" and label "Parent".
 * Each child is saved with role "other" and label "Child 1", "Child 2", etc.
 */
function SaveToGroup({
  accounts,
  parentPublicKey,
  stepNumber,
}: {
  accounts: GeneratedAccount[];
  parentPublicKey: string; // resolved parent public key
  stepNumber: number;
}) {
  const { settings } = useSettings();
  const { groups, createGroup, upsertMember } = useAssetGroups();

  const [groupName, setGroupName] = useState("Ghost Senders");
  const [savedGroupId, setSavedGroupId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const funded = accounts.filter((a) => a.status === "funded");

  async function handleSave() {
    if (!funded.length) {
      toast.error("No funded accounts to save.");
      return;
    }
    if (!groupName.trim()) {
      toast.error("Enter a group name.");
      return;
    }
    if (!parentPublicKey) {
      toast.error("No parent account selected.");
      return;
    }

    setIsSaving(true);
    try {
      // Reuse existing group if name matches, otherwise create a new one
      let gid = groups.find((g) => g.name === groupName.trim())?.id;
      if (!gid) {
        gid = createGroup({ name: groupName.trim(), network: settings.network });
      }

      // Save parent as "bank" role with label "Parent"
      upsertMember(gid, {
        address: parentPublicKey,
        role: "bank",
        label: "Parent",
        notes: `Parent account — ${new Date().toLocaleDateString()}`,
      });

      // Save each funded child with role "other" and label "Child N"
      funded.forEach((acc, i) => {
        upsertMember(gid!, {
          address: acc.publicKey,
          role: "other",
          label: `Child ${i + 1}`,
          notes: `Created ${new Date().toLocaleDateString()}`,
        });
      });

      setSavedGroupId(gid);
      toast.success(`Parent + ${funded.length} children saved to "${groupName.trim()}".`);
    } finally {
      setIsSaving(false);
    }
  }

  // Only show when there are funded children AND a parent is available
  if (!funded.length || !parentPublicKey) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {stepNumber}
          </span>
          Save to Asset Group
        </CardTitle>
        <CardDescription>
          Saves the parent account (role: Bank) and all {funded.length} children (role: Other)
          to a single group. You can load them later in Ghost Payments via "From Group".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="group-name">Group name</Label>
          <Input
            id="group-name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Ghost Senders"
          />
        </div>

        {/* Preview what will be saved */}
        <div className="rounded-md border px-3 py-2 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-orange-400 border-orange-400/30 bg-orange-400/10 text-[10px]">
              BANK
            </Badge>
            <span className="font-mono">
              <ShortAddress address={parentPublicKey} network={settings.network} />
            </span>
            <span className="text-muted-foreground">Parent</span>
          </div>
          {funded.slice(0, 3).map((acc, i) => (
            <div key={acc.publicKey} className="flex items-center gap-2">
              <Badge variant="outline" className="text-gray-400 border-gray-400/30 bg-gray-400/10 text-[10px]">
                OTHER
              </Badge>
              <span className="font-mono">
                <ShortAddress address={acc.publicKey} network={settings.network} />
              </span>
              <span className="text-muted-foreground">Child {i + 1}</span>
            </div>
          ))}
          {funded.length > 3 && (
            <p className="text-muted-foreground">+{funded.length - 3} more children</p>
          )}
        </div>

        {/* Success confirmation with link to open the group */}
        {savedGroupId && (
          <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>
              Parent + {funded.length} children saved to &quot;{groupName}&quot;
            </span>
            <a
              href={`/groups?open=${savedGroupId}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-primary underline-offset-4 hover:underline"
            >
              Open Group →
            </a>
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-3 flex-wrap">
        <Button
          onClick={handleSave}
          disabled={isSaving || !groupName.trim()}
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Save parent + {funded.length} children to group
        </Button>
        {savedGroupId && (
          <a
            href="/ghost-payments"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            Go to Ghost Payments <ChevronRight className="h-3 w-3" />
          </a>
        )}
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AccountFunderPanel() {
  const { settings } = useSettings();
  const { activeWallet } = useActiveWallet();
  const { wallets } = useWalletsV2();

  const horizonUrl = resolveHorizonUrl(settings);
  const networkPassphrase = resolveNetworkPassphrase(settings.network);

  // ── Step 1: Parent account state ────────────────────────────────────────
  const [parentMode, setParentMode] = useState<"wallet" | "generated">("wallet");

  // Wallet mode state
  const [parentWalletId, setParentWalletId] = useState<string | null>(
    activeWallet?.id ?? null
  );
  const [parentManualKey, setParentManualKey] = useState("");
  const [parentShowManualKey, setParentShowManualKey] = useState(false);

  // Generated mode state
  const [generatedParentPublic, setGeneratedParentPublic] = useState("");
  const [generatedParentSecret, setGeneratedParentSecret] = useState("");
  const [showGeneratedSecret, setShowGeneratedSecret] = useState(false);

  // Parent balance (checked from Horizon)
  const [parentBalance, setParentBalance] = useState<string | null>(null);
  const [parentBalanceLoading, setParentBalanceLoading] = useState(false);

  // Auto-check polling for generated parent
  const [autoCheck, setAutoCheck] = useState(false);
  const autoCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Step 2: Children state ──────────────────────────────────────────────
  const [count, setCount] = useState("10");
  const [accounts, setAccounts] = useState<GeneratedAccount[]>([]);
  const [revealAll, setRevealAll] = useState(false);

  // ── Step 3: Funding state ───────────────────────────────────────────────
  const [xlmEach, setXlmEach] = useState("3");
  const [isDirectFunding, setIsDirectFunding] = useState(false);
  const [isSponsoring, setIsSponsoring] = useState(false);

  // The parent public key that actually performed the funding, captured at
  // the moment a funding run starts. Save to Group must use THIS value, not
  // whatever the parent selector currently shows — the user may switch
  // parents after funding completes but before saving.
  const [fundedByParentPublicKey, setFundedByParentPublicKey] = useState<string | null>(
    null
  );

  // Close tab state
  const [closeKeypairsText, setCloseKeypairsText] = useState("");
  const [closeDestination, setCloseDestination] = useState("");
  const [closeSponsorWalletId, setCloseSponsorWalletId] = useState<string | null>(
    activeWallet?.id ?? null
  );
  const [closeSponsorManualKey, setCloseSponsorManualKey] = useState("");
  const [closeSponsorShowKey, setCloseSponsorShowKey] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeResults, setCloseResults] = useState<
    { publicKey: string; status: CloseStatus; error?: string }[]
  >([]);

  // Copy feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Shared abort controller for stopping mid-run
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Derived: resolve the parent's secret key and public key from current state
  // ---------------------------------------------------------------------------

  /** Get the parent's secret key from whichever mode is active */
  function resolveParentKey(): string {
    if (parentMode === "wallet") {
      if (parentWalletId) {
        return wallets.find((w) => w.id === parentWalletId)?.secretKey ?? "";
      }
      return parentManualKey.trim();
    }
    // Generated mode
    return generatedParentSecret;
  }

  /** Get the parent's public key from whichever mode is active */
  function resolveParentPublicKey(): string {
    if (parentMode === "wallet") {
      if (parentWalletId) {
        return wallets.find((w) => w.id === parentWalletId)?.publicKey ?? "";
      }
      // Derive from manual secret key
      try {
        return Keypair.fromSecret(parentManualKey.trim()).publicKey();
      } catch {
        return "";
      }
    }
    return generatedParentPublic;
  }

  /** Resolve key from a wallet picker (used for close-tab sponsor) */
  function resolveKey(walletId: string | null, manualKey: string): string {
    if (walletId) return wallets.find((w) => w.id === walletId)?.secretKey ?? "";
    return manualKey.trim();
  }

  const parentSecretKey = resolveParentKey();
  const parentPublicKey = resolveParentPublicKey();
  const hasParent = parentSecretKey.length > 0 && parentPublicKey.length > 0;

  // ---------------------------------------------------------------------------
  // Step 1: Parent balance fetching
  // ---------------------------------------------------------------------------

  /** Fetch the parent account balance from Horizon */
  const fetchParentBalance = useCallback(async () => {
    if (!parentPublicKey) return;
    setParentBalanceLoading(true);
    try {
      const server = new StellarSdk.Horizon.Server(horizonUrl);
      const account = await server.loadAccount(parentPublicKey);
      // Find the native (XLM) balance entry
      const native = account.balances.find(
        (b: any) => b.asset_type === "native"
      );
      setParentBalance(native ? (native as any).balance : "0");
    } catch (err: any) {
      // 404 = account not found on ledger (not yet funded)
      if (err?.response?.status === 404) {
        setParentBalance("0");
      } else {
        setParentBalance(null);
        toast.error("Failed to check balance.");
      }
    } finally {
      setParentBalanceLoading(false);
    }
  }, [parentPublicKey, horizonUrl]);

  /** Generate a new parent keypair (for "generated" mode) */
  function handleGenerateParent() {
    // A previously generated parent may already hold real, unrecoverable XLM —
    // never silently discard its secret key.
    const hasBalance =
      generatedParentPublic.length > 0 &&
      parentBalance !== null &&
      parseFloat(parentBalance) > 0;
    if (hasBalance) {
      const confirmed = window.confirm(
        "The current generated parent keypair has a non-zero XLM balance. " +
          "Regenerating will PERMANENTLY DISCARD its secret key — that XLM may " +
          "become unrecoverable unless you have already saved the secret key " +
          "elsewhere. Continue?"
      );
      if (!confirmed) return;
    }

    const kp = Keypair.random();
    setGeneratedParentPublic(kp.publicKey());
    setGeneratedParentSecret(kp.secret());
    setParentBalance(null);
    setAutoCheck(false);
    toast.success("Parent keypair generated.");
  }

  // Auto-check: poll every 5s for the generated parent's balance
  useEffect(() => {
    // Clear any existing interval on every re-evaluation
    if (autoCheckRef.current) {
      clearInterval(autoCheckRef.current);
      autoCheckRef.current = null;
    }

    if (!autoCheck || !generatedParentPublic || parentMode !== "generated") return;

    // Poll immediately, then every 5 seconds
    fetchParentBalance();
    autoCheckRef.current = setInterval(() => {
      fetchParentBalance();
    }, 5000);

    return () => {
      if (autoCheckRef.current) {
        clearInterval(autoCheckRef.current);
        autoCheckRef.current = null;
      }
    };
  }, [autoCheck, generatedParentPublic, parentMode, fetchParentBalance]);

  // Stop auto-check once balance is sufficient
  const n = parseInt(count) || 0;
  // Once children are actually generated, cost estimates must track the real
  // accounts that will be funded — not the live "count" field, which can be
  // edited afterward without re-generating and would silently diverge from
  // what the Fund/Create loops (which use accounts.length) actually spend.
  const effectiveN = accounts.length > 0 ? accounts.length : n;
  const requiredXlm = (parseFloat(xlmEach) || 0) * effectiveN + 2; // buffer for fees + base reserve
  useEffect(() => {
    if (
      autoCheck &&
      parentBalance !== null &&
      parseFloat(parentBalance) >= requiredXlm
    ) {
      setAutoCheck(false);
      toast.success("Parent funded! Balance is sufficient.");
    }
  }, [autoCheck, parentBalance, requiredXlm]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (autoCheckRef.current) {
        clearInterval(autoCheckRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Step 2: Generate children
  // ---------------------------------------------------------------------------

  /** Generate N fresh random keypairs for children */
  function handleGenerateChildren() {
    // Any account already funded holds real, unrecoverable XLM tied to a
    // secret key that only exists in this component's state — never silently
    // discard it.
    const hasFundedAccounts = accounts.some((a) => a.status === "funded");
    if (hasFundedAccounts) {
      const confirmed = window.confirm(
        "One or more generated children have already been funded with real " +
          "XLM. Regenerating will PERMANENTLY DISCARD their secret keys — that " +
          "XLM may become unrecoverable unless you have already saved/exported " +
          "them. Continue?"
      );
      if (!confirmed) return;
    }

    const num = Math.min(Math.max(parseInt(count) || 1, 1), 100);
    const generated: GeneratedAccount[] = Array.from({ length: num }, () => {
      const kp = Keypair.random(); // cryptographically random, runs in browser
      return { publicKey: kp.publicKey(), secretKey: kp.secret(), status: "pending" };
    });
    setAccounts(generated);
    setRevealAll(false);
  }

  // Warn before leaving the page if any child has already been funded with
  // real XLM — secret keys only ever live in this component's state and are
  // never persisted, so navigating away without copying/exporting them first
  // can permanently strand real funds.
  useEffect(() => {
    const hasFundedAccounts = accounts.some((a) => a.status === "funded");
    if (!hasFundedAccounts) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue =
        "Funded accounts have secret keys that only exist on this page — leaving now may permanently strand real XLM.";
      return e.returnValue;
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [accounts]);

  // ---------------------------------------------------------------------------
  // Shared stop handler
  // ---------------------------------------------------------------------------

  function handleStop() {
    abortRef.current?.abort();
    setIsDirectFunding(false);
    setIsSponsoring(false);
    setIsClosing(false);
  }

  // ---------------------------------------------------------------------------
  // Step 3, Tab 1 — Direct Funding
  //
  // Parent sends createAccount(child, xlmEach) for each child.
  // Batches up to 50 createAccount ops per transaction.
  // ---------------------------------------------------------------------------

  async function handleDirectFund() {
    if (isDirectFunding) return;
    if (!accounts.length) { toast.error("Generate children first."); return; }
    if (!parentSecretKey) { toast.error("Select or generate a parent account."); return; }

    const amount = parseFloat(xlmEach);
    if (!amount || amount < 1) { toast.error("Minimum starting balance is 1 XLM."); return; }

    let parentKeypair: Keypair;
    try { parentKeypair = Keypair.fromSecret(parentSecretKey); }
    catch { toast.error("Invalid parent secret key."); return; }

    // Capture the actual funding parent now — the live selector may be
    // switched later, before the user saves to a group.
    setFundedByParentPublicKey(parentKeypair.publicKey());

    setIsDirectFunding(true);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const server = new StellarSdk.Horizon.Server(horizonUrl);

    // Max ops per tx on Stellar is 100; we use 50 to stay safe
    const BATCH_SIZE = 50;

    // Reset all statuses before starting
    setAccounts((prev) => prev.map((a) => ({ ...a, status: "pending", error: undefined })));

    const snapshot = [...accounts]; // stable copy so indices don't shift mid-run

    for (let i = 0; i < snapshot.length; i += BATCH_SIZE) {
      if (signal.aborted) break;

      const batch = snapshot.slice(i, i + BATCH_SIZE);

      // Mark this batch as in-progress
      setAccounts((prev) =>
        prev.map((a, idx) =>
          idx >= i && idx < i + BATCH_SIZE ? { ...a, status: "funding" } : a
        )
      );

      try {
        // Reload account before each batch for fresh sequence number
        const parentAccount = await server.loadAccount(parentKeypair.publicKey());
        const fee = await server.fetchBaseFee();

        const builder = new TransactionBuilder(parentAccount, {
          fee: String(fee * 2), // 2x base fee for confirmation speed
          networkPassphrase,
        });

        for (const acc of batch) {
          // createAccount funds AND creates the address in one op
          builder.addOperation(
            Operation.createAccount({
              destination: acc.publicKey,
              startingBalance: amount.toFixed(7),
            })
          );
        }

        const tx = builder.setTimeout(60).build();
        tx.sign(parentKeypair);
        await server.submitTransaction(tx);

        // All ops in the batch succeeded
        setAccounts((prev) =>
          prev.map((a, idx) =>
            idx >= i && idx < i + BATCH_SIZE ? { ...a, status: "funded" } : a
          )
        );
      } catch (err: any) {
        // Horizon returns per-op result codes in the error extras
        const opCodes: string[] =
          err?.response?.data?.extras?.result_codes?.operations ?? [];

        // Stellar transactions are atomic — since submitTransaction threw,
        // NOTHING in this batch was committed to the ledger, even though
        // Horizon may still report "op_success" for ops that would have
        // succeeded had the tx not aborted. Only "op_already_exists" is real
        // evidence (the account genuinely exists on-ledger already); anything
        // reported as "op_success" here is ambiguous and must be verified
        // directly against Horizon before it can be trusted.
        const ambiguous: string[] = [];
        setAccounts((prev) =>
          prev.map((a, idx) => {
            if (idx < i || idx >= i + BATCH_SIZE) return a;
            const opIdx = idx - i;
            const code = opCodes[opIdx] ?? "unknown";
            if (code === "op_already_exists") {
              return { ...a, status: "funded" };
            }
            if (code === "op_success") {
              ambiguous.push(a.publicKey);
              return { ...a, status: "failed", error: "unconfirmed — verifying…" };
            }
            return { ...a, status: "failed", error: code };
          })
        );

        if (ambiguous.length > 0) {
          await verifyAmbiguousAccounts(ambiguous, server, setAccounts);
        }
      }
    }

    setIsDirectFunding(false);
    toast.success("Direct funding complete.");
  }

  // ---------------------------------------------------------------------------
  // Step 3, Tab 2 — Sponsored Accounts
  //
  // For each child, a single transaction contains 3 operations:
  //   Op 1: BeginSponsoringFutureReserves (source: parent)
  //   Op 2: CreateAccount with startingBalance 0 (source: parent)
  //   Op 3: EndSponsoringFutureReserves (source: child — child must sign)
  //
  // Batch 10 children per tx (= 30 ops, well under 100 limit).
  // Both parent + each child in the batch sign the transaction.
  // ---------------------------------------------------------------------------

  async function handleSponsoredCreate() {
    if (isSponsoring) return;
    if (!accounts.length) { toast.error("Generate children first."); return; }
    if (!parentSecretKey) { toast.error("Select or generate a parent account."); return; }

    let parentKeypair: Keypair;
    try { parentKeypair = Keypair.fromSecret(parentSecretKey); }
    catch { toast.error("Invalid parent secret key."); return; }

    // Capture the actual funding parent now — the live selector may be
    // switched later, before the user saves to a group.
    setFundedByParentPublicKey(parentKeypair.publicKey());

    setIsSponsoring(true);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const server = new StellarSdk.Horizon.Server(horizonUrl);

    // 10 children per tx = 30 ops per tx (3 ops x 10 children)
    const BATCH_SIZE = 10;

    setAccounts((prev) => prev.map((a) => ({ ...a, status: "pending", error: undefined })));

    const snapshot = [...accounts];

    for (let i = 0; i < snapshot.length; i += BATCH_SIZE) {
      if (signal.aborted) break;

      const batch = snapshot.slice(i, i + BATCH_SIZE);

      // Mark batch as in-progress
      setAccounts((prev) =>
        prev.map((a, idx) =>
          idx >= i && idx < i + BATCH_SIZE ? { ...a, status: "funding" } : a
        )
      );

      try {
        const parentAccount = await server.loadAccount(parentKeypair.publicKey());
        const fee = await server.fetchBaseFee();

        const builder = new TransactionBuilder(parentAccount, {
          // TransactionBuilder treats `fee` as a PER-OPERATION rate and
          // multiplies it internally by the actual op count on build() — do
          // NOT also multiply by batch.length here, or the total fee is
          // squared (way off at larger batch sizes).
          fee: String(fee * 3), // 3 ops per child
          networkPassphrase,
        });

        for (const acc of batch) {
          // Op 1: Parent announces it will cover the reserve for this child
          builder.addOperation(
            Operation.beginSponsoringFutureReserves({
              sponsoredId: acc.publicKey,
              source: parentKeypair.publicKey(),
            })
          );

          // Op 2: Create the child account with 0 XLM (reserve covered by parent)
          builder.addOperation(
            Operation.createAccount({
              destination: acc.publicKey,
              // The Stellar JS SDK rejects "0" locally (validates > 0).
              // 1 stroop (0.0000001 XLM) satisfies the SDK while the sponsor
              // covers the actual 1 XLM base reserve — the child keeps only 1 stroop.
              startingBalance: "0.0000001",
            })
          );

          // Op 3: Child accepts the sponsorship (source must be the child)
          builder.addOperation(
            Operation.endSponsoringFutureReserves({
              source: acc.publicKey,
            })
          );
        }

        const tx = builder.setTimeout(60).build();

        // Parent signs the whole transaction
        tx.sign(parentKeypair);

        // Each child in the batch must also sign (for EndSponsoringFutureReserves)
        for (const acc of batch) {
          const childKp = Keypair.fromSecret(acc.secretKey);
          tx.sign(childKp);
        }

        await server.submitTransaction(tx);

        // Mark batch as successfully created
        setAccounts((prev) =>
          prev.map((a, idx) =>
            idx >= i && idx < i + BATCH_SIZE ? { ...a, status: "funded" } : a
          )
        );
      } catch (err: any) {
        // Each child maps to 3 ops; op index / 3 gives child index within batch
        const opCodes: string[] =
          err?.response?.data?.extras?.result_codes?.operations ?? [];

        // Stellar transactions are atomic — since submitTransaction threw,
        // NOTHING in this batch was committed to the ledger, even though
        // Horizon may still report "op_success" for ops that would have
        // succeeded had the tx not aborted. Only "op_already_exists" is real
        // evidence; "op_success" here is ambiguous and must be verified
        // directly against Horizon before it can be trusted.
        const ambiguous: string[] = [];
        setAccounts((prev) =>
          prev.map((a, idx) => {
            if (idx < i || idx >= i + BATCH_SIZE) return a;
            const acctIdx = idx - i;
            const code = opCodes[acctIdx * 3 + 2] ?? opCodes[acctIdx * 3] ?? "unknown";
            if (code === "op_already_exists") {
              return { ...a, status: "funded" };
            }
            if (code === "op_success") {
              ambiguous.push(a.publicKey);
              return { ...a, status: "failed", error: "unconfirmed — verifying…" };
            }
            return { ...a, status: "failed", error: code };
          })
        );

        if (ambiguous.length > 0) {
          await verifyAmbiguousAccounts(ambiguous, server, setAccounts);
        }
      }
    }

    setIsSponsoring(false);
    toast.success("Sponsored account creation complete.");
  }

  // ---------------------------------------------------------------------------
  // Step 3, Tab 3 — Close Accounts
  //
  // Closes accounts using accountMerge + FeeBumpTransaction.
  // For each account:
  //   Inner tx (signed by account): accountMerge -> sends XLM to destination
  //   Outer fee bump tx (signed by sponsor): pays fee for 0-XLM accounts
  //
  // Accounts closed one at a time (each needs fresh sequence number).
  // ---------------------------------------------------------------------------

  async function handleCloseAccounts() {
    if (isClosing) return;
    const sponsorKey = resolveKey(closeSponsorWalletId, closeSponsorManualKey);
    if (!sponsorKey) { toast.error("Select a sponsor wallet or enter a secret key."); return; }

    // Parse "PUBLIC<tab or comma>SECRET" pairs from the textarea
    const pairs = closeKeypairsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.includes("\t") ? line.split("\t") : line.split(",");
        return { publicKey: parts[0]?.trim() ?? "", secretKey: parts[1]?.trim() ?? "" };
      })
      .filter((p) => p.publicKey && p.secretKey);

    if (!pairs.length) {
      toast.error("Paste at least one PUBLIC<tab>SECRET pair.");
      return;
    }

    let sponsorKeypair: Keypair;
    try { sponsorKeypair = Keypair.fromSecret(sponsorKey); }
    catch { toast.error("Invalid sponsor secret key."); return; }

    // Destination defaults to sponsor's address if left blank
    const destination = closeDestination.trim() || sponsorKeypair.publicKey();

    setIsClosing(true);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const server = new StellarSdk.Horizon.Server(horizonUrl);

    // Initialize results list
    setCloseResults(pairs.map((p) => ({ publicKey: p.publicKey, status: "pending" })));

    for (let i = 0; i < pairs.length; i++) {
      if (signal.aborted) break;

      const { publicKey, secretKey } = pairs[i];

      // Mark as in-progress
      setCloseResults((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "closing" } : r))
      );

      try {
        let accountKeypair: Keypair;
        try { accountKeypair = Keypair.fromSecret(secretKey); }
        catch {
          setCloseResults((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: "invalid secret key" } : r))
          );
          continue;
        }

        // Load account for its current sequence number
        const closingAccount = await server.loadAccount(publicKey);
        const fee = await server.fetchBaseFee();

        // Inner tx: accountMerge destroys the account, sends XLM to destination
        const innerTx = new TransactionBuilder(closingAccount, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase,
        })
          .addOperation(
            Operation.accountMerge({ destination })
          )
          .setTimeout(60)
          .build();

        // Account being closed must sign its own accountMerge
        innerTx.sign(accountKeypair);

        // Fee bump: sponsor pays the fee so 0-XLM accounts can close
        const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
          sponsorKeypair,
          String(fee * 2),
          innerTx,
          networkPassphrase
        );

        feeBumpTx.sign(sponsorKeypair);
        await server.submitTransaction(feeBumpTx);

        // Account deleted, reserve returned to sponsor
        setCloseResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "closed" } : r))
        );
      } catch (err: any) {
        const opCodes: string[] =
          err?.response?.data?.extras?.result_codes?.inner_result_codes?.operations ??
          err?.response?.data?.extras?.result_codes?.operations ?? [];
        const code = opCodes[0] ?? err?.message ?? "unknown error";

        setCloseResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: code } : r))
        );
      }
    }

    setIsClosing(false);
    toast.success("Done — accounts closed.");
  }

  // ---------------------------------------------------------------------------
  // Copy helpers
  // ---------------------------------------------------------------------------

  function handleCopyOne(key: string) {
    navigator.clipboard.writeText(key).then(
      () => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
      },
      () => {
        toast.error("Failed to copy to clipboard.");
      }
    );
  }

  function handleCopyAll() {
    if (!accounts.length) { toast.error("No accounts to copy."); return; }
    const text = accounts.map((a) => `${a.publicKey}\t${a.secretKey}`).join("\n");
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
        toast.success("Copied (public + secret, tab-separated).");
      },
      () => {
        toast.error("Failed to copy to clipboard.");
      }
    );
  }

  function handleDownloadCSV() {
    const header = "public_key,secret_key,status\n";
    const rows = accounts.map((a) => `${a.publicKey},${a.secretKey},${a.status}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "accounts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const hasChildren = accounts.length > 0;
  const directTotalCost = (parseFloat(xlmEach) || 0) * effectiveN;
  // Sponsored reserves: 1 XLM locked per child in the parent's balance (not spent)
  const sponsoredReserveCost = effectiveN * 1;
  // Whether the generated parent has enough balance
  const parentFunded =
    parentMode === "generated" &&
    parentBalance !== null &&
    parseFloat(parentBalance) >= requiredXlm;

  // Mode-agnostic balance checks for the Fund/Create submit buttons — applies
  // to wallet-mode and manual-key parents too, not just generated-mode.
  // Only blocks submission when a balance has actually been fetched and is
  // known to be insufficient; an unfetched (null) balance never blocks.
  const directRequiredXlm = directTotalCost + 2; // amount sent + fee buffer
  const directParentInsufficient =
    parentBalance !== null && parseFloat(parentBalance) < directRequiredXlm;

  const sponsoredRequiredXlm = sponsoredReserveCost + 1; // reserve + fee buffer
  const sponsoredParentInsufficient =
    parentBalance !== null && parseFloat(parentBalance) < sponsoredRequiredXlm;

  // For the "Copy parent public key" button
  const [copiedParentPub, setCopiedParentPub] = useState(false);
  function handleCopyParentPublic() {
    if (!generatedParentPublic) return;
    navigator.clipboard.writeText(generatedParentPublic).then(
      () => {
        setCopiedParentPub(true);
        setTimeout(() => setCopiedParentPub(false), 2000);
      },
      () => {
        toast.error("Failed to copy to clipboard.");
      }
    );
  }
  const [copiedParentSec, setCopiedParentSec] = useState(false);
  function handleCopyParentSecret() {
    if (!generatedParentSecret) return;
    navigator.clipboard.writeText(generatedParentSecret).then(
      () => {
        setCopiedParentSec(true);
        setTimeout(() => setCopiedParentSec(false), 2000);
      },
      () => {
        toast.error("Failed to copy to clipboard.");
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ================================================================== */}
      {/* Step 1 — Parent Account                                            */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </span>
            Parent Account
          </CardTitle>
          <CardDescription>
            The parent account funds and sponsors all child accounts.
            Use an existing wallet or generate a new keypair.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode toggle: wallet vs generated */}
          <div className="flex gap-2">
            <Button
              variant={parentMode === "wallet" ? "default" : "outline"}
              size="sm"
              onClick={() => setParentMode("wallet")}
              className="gap-2"
            >
              <Wallet className="h-4 w-4" />
              Use existing wallet
            </Button>
            <Button
              variant={parentMode === "generated" ? "default" : "outline"}
              size="sm"
              onClick={() => setParentMode("generated")}
              className="gap-2"
            >
              <Zap className="h-4 w-4" />
              Generate new parent
            </Button>
          </div>

          {/* ── Option A: Existing wallet ── */}
          {parentMode === "wallet" && (
            <div className="space-y-3">
              <WalletPicker
                wallets={wallets}
                walletId={parentWalletId}
                manualKey={parentManualKey}
                showManual={parentShowManualKey}
                onWalletChange={(id) => {
                  setParentWalletId(id);
                  setParentBalance(null);
                }}
                onManualKeyChange={(val) => {
                  setParentManualKey(val);
                  setParentBalance(null);
                }}
                onToggleShow={() => setParentShowManualKey((v) => !v)}
                label="Parent wallet"
                network={settings.network}
              />
              {/* Show balance when a wallet is selected */}
              {parentPublicKey && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchParentBalance}
                    disabled={parentBalanceLoading}
                    className="gap-2 text-xs"
                  >
                    {parentBalanceLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Check Balance
                  </Button>
                  {parentBalance !== null && (
                    <span className="text-sm font-mono">
                      {parseFloat(parentBalance).toFixed(2)} XLM
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Option B: Generate new parent ── */}
          {parentMode === "generated" && (
            <div className="space-y-4">
              {!generatedParentPublic ? (
                // No keypair yet — show generate button
                <Button onClick={handleGenerateParent} className="gap-2">
                  <Zap className="h-4 w-4" />
                  Generate parent keypair
                </Button>
              ) : (
                // Keypair generated — show public key, masked secret, balance check
                <div className="space-y-3">
                  {/* Public key — large and copyable */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Public Key</Label>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <span className="font-mono text-sm break-all flex-1">
                        {generatedParentPublic}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={handleCopyParentPublic}
                      >
                        {copiedParentPub ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Secret key — masked with reveal toggle + copy */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Secret Key</Label>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <span className="font-mono text-sm break-all flex-1">
                        {showGeneratedSecret
                          ? generatedParentSecret
                          : generatedParentSecret.slice(0, 4) +
                            "••••••••••••••••••••••••••••••••••••••••••••" +
                            generatedParentSecret.slice(-4)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => setShowGeneratedSecret((v) => !v)}
                      >
                        {showGeneratedSecret ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={handleCopyParentSecret}
                      >
                        {copiedParentSec ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Funding instruction */}
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                    <p>
                      <strong>Required:</strong> Send at least{" "}
                      <strong>{requiredXlm.toFixed(2)} XLM</strong> to the address
                      above ({effectiveN} children x {xlmEach} XLM + ~2 XLM fees buffer).
                    </p>
                    <p>Then click "Check Balance" or enable auto-check.</p>
                  </div>

                  {/* Balance check controls */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchParentBalance}
                      disabled={parentBalanceLoading}
                      className="gap-2 text-xs"
                    >
                      {parentBalanceLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Check Balance
                    </Button>

                    {/* Auto-check toggle — polls every 5s */}
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Switch
                        checked={autoCheck}
                        onCheckedChange={(checked) => setAutoCheck(checked)}
                      />
                      Auto-check every 5s
                    </label>

                    {parentBalance !== null && (
                      <span className="text-sm font-mono">
                        {parseFloat(parentBalance).toFixed(2)} XLM
                      </span>
                    )}
                  </div>

                  {/* Funded banner */}
                  {parentFunded && (
                    <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span>
                        Parent funded ({parseFloat(parentBalance!).toFixed(2)} XLM)
                      </span>
                    </div>
                  )}

                  {/* Re-generate button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerateParent}
                    className="gap-2 text-xs text-muted-foreground"
                  >
                    <RefreshCcw className="h-3 w-3" />
                    Re-generate parent keypair
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Step 2 — Generate Children                                         */}
      {/* ================================================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
              2
            </span>
            Generate Children
          </CardTitle>
          <CardDescription>
            New keypairs are created entirely in your browser using cryptographic randomness.
            They are never transmitted anywhere until you fund them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-[180px]">
            <Label htmlFor="count">Number of children</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleGenerateChildren}
            disabled={isDirectFunding || isSponsoring || isClosing}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {hasChildren ? "Re-generate" : "Generate"} children
          </Button>
        </CardFooter>
      </Card>

      {/* ================================================================== */}
      {/* Children list — shown after generation                             */}
      {/* ================================================================== */}
      {hasChildren && (
        <AccountList
          accounts={accounts}
          revealAll={revealAll}
          onToggleReveal={() => setRevealAll((v) => !v)}
          onCopyOne={handleCopyOne}
          onCopyAll={handleCopyAll}
          onDownloadCSV={handleDownloadCSV}
          copiedKey={copiedKey}
          copiedAll={copiedAll}
          labelPrefix="Child"
          network={settings.network}
        />
      )}

      {/* ================================================================== */}
      {/* Step 3 — Create / Close (tabs)                                     */}
      {/* ================================================================== */}
      <Tabs defaultValue="direct">
        <TabsList className="mb-4 w-full">
          {/* Tab 1: parent sends XLM to each child (createAccount) */}
          <TabsTrigger value="direct" className="flex-1 gap-2">
            <Wallet className="h-4 w-4" />
            Direct Funding
          </TabsTrigger>
          {/* Tab 2: parent sponsors reserves, children get 0 XLM */}
          <TabsTrigger value="sponsored" className="flex-1 gap-2">
            <Shield className="h-4 w-4" />
            Sponsored
          </TabsTrigger>
          {/* Tab 3: close/delete accounts and reclaim reserves */}
          <TabsTrigger value="close" className="flex-1 gap-2">
            <Trash2 className="h-4 w-4" />
            Close Accounts
          </TabsTrigger>
        </TabsList>

        {/* ── Direct Funding ──────────────────────────────────────────── */}
        <TabsContent value="direct" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  3
                </span>
                Direct Funding
              </CardTitle>
              <CardDescription>
                Parent sends X XLM to each child using <code>createAccount</code>.
                Each child is fully independent — holds its own XLM for fees.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Amount per child */}
              <div className="space-y-2 max-w-[180px]">
                <Label htmlFor="xlm">XLM per child</Label>
                <Input
                  id="xlm"
                  type="number"
                  min={1}
                  step={0.5}
                  value={xlmEach}
                  onChange={(e) => setXlmEach(e.target.value)}
                />
              </div>
              {directTotalCost > 0 && (
                <p className="text-xs text-muted-foreground">
                  Total outgoing from parent:{" "}
                  <strong>{directTotalCost.toFixed(2)} XLM</strong> + tx fees
                </p>
              )}
              {/* Parent summary */}
              {hasParent && (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                  <Wallet className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Parent:</span>
                  <span className="font-mono">
                    <ShortAddress address={parentPublicKey} network={settings.network} />
                  </span>
                </div>
              )}
              {/* Insufficient parent balance warning — applies to any parent mode */}
              {hasParent && directParentInsufficient && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Parent balance ({parseFloat(parentBalance!).toFixed(2)} XLM) is below
                  the required {directRequiredXlm.toFixed(2)} XLM for this batch.
                </div>
              )}
            </CardContent>
            <CardFooter>
              {!isDirectFunding ? (
                <Button
                  onClick={handleDirectFund}
                  disabled={!hasParent || !hasChildren || directParentInsufficient}
                  className="gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  Fund {accounts.length} children
                </Button>
              ) : (
                <Button variant="destructive" onClick={handleStop} className="gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stop
                </Button>
              )}
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Sponsored Accounts ──────────────────────────────────────── */}
        <TabsContent value="sponsored" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  3
                </span>
                Sponsored Accounts
              </CardTitle>
              <CardDescription>
                Parent covers the 1 XLM base reserve for every child.
                Children are created with <strong>0 XLM</strong> — they need a fee bump
                from the parent each time they transact.
                <br />
                <span className="text-xs mt-1 block">
                  Benefit: watch only 1 address (the parent) for XLM. The reserve XLM is
                  locked in the parent's balance but <em>not spent</em>.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sponsoredReserveCost > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  <p>
                    <strong>{sponsoredReserveCost} XLM</strong> will be locked in the
                    parent's balance as reserve ({effectiveN} x 1 XLM).
                  </p>
                  <p>
                    This XLM is not spent — but the parent cannot withdraw it while the
                    children exist.
                  </p>
                </div>
              )}
              {/* Parent summary */}
              {hasParent && (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                  <Shield className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Sponsor (parent):</span>
                  <span className="font-mono">
                    <ShortAddress address={parentPublicKey} network={settings.network} />
                  </span>
                </div>
              )}
              {/* Insufficient parent balance warning — applies to any parent mode */}
              {hasParent && sponsoredParentInsufficient && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Parent balance ({parseFloat(parentBalance!).toFixed(2)} XLM) is below
                  the required {sponsoredRequiredXlm.toFixed(2)} XLM for this batch.
                </div>
              )}
            </CardContent>
            <CardFooter>
              {!isSponsoring ? (
                <Button
                  onClick={handleSponsoredCreate}
                  disabled={!hasParent || !hasChildren || sponsoredParentInsufficient}
                  className="gap-2"
                >
                  <Shield className="h-4 w-4" />
                  Create {accounts.length} sponsored children
                </Button>
              ) : (
                <Button variant="destructive" onClick={handleStop} className="gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stop
                </Button>
              )}
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Close Accounts ──────────────────────────────────────────── */}
        <TabsContent value="close" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-destructive" />
                Close Accounts
              </CardTitle>
              <CardDescription>
                Permanently deletes accounts using <code>accountMerge</code>.
                The sponsor fee-bumps every transaction so accounts with 0 XLM
                can close themselves. If an account was sponsored, its reserve
                may be returned to whichever account originally sponsored it —
                not necessarily the wallet selected here to pay fees.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Keypairs input */}
              <div className="space-y-2">
                <Label htmlFor="close-pairs">
                  Accounts to close{" "}
                  <span className="text-muted-foreground font-normal">
                    — paste PUBLIC{"\t"}SECRET pairs, one per line
                  </span>
                </Label>
                <textarea
                  id="close-pairs"
                  className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={"GABC...WXYZ\tSABC...WXYZ\nGDEF...UVWX\tSDEF...UVWX"}
                  value={closeKeypairsText}
                  onChange={(e) => setCloseKeypairsText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Tip: use the "Copy all" button in the children list — it copies in this exact format.
                </p>
              </div>

              {/* Destination for merged XLM */}
              <div className="space-y-2">
                <Label htmlFor="close-dest">
                  Destination for remaining XLM{" "}
                  <span className="text-muted-foreground font-normal">
                    — leave blank to send to sponsor
                  </span>
                </Label>
                <Input
                  id="close-dest"
                  placeholder="G... (defaults to sponsor address)"
                  value={closeDestination}
                  onChange={(e) => setCloseDestination(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              {/* Sponsor wallet picker for close operations */}
              <WalletPicker
                wallets={wallets}
                walletId={closeSponsorWalletId}
                manualKey={closeSponsorManualKey}
                showManual={closeSponsorShowKey}
                onWalletChange={setCloseSponsorWalletId}
                onManualKeyChange={setCloseSponsorManualKey}
                onToggleShow={() => setCloseSponsorShowKey((v) => !v)}
                label="Sponsor wallet (pays fees)"
                network={settings.network}
              />

              {/* Results list — shown once close has started */}
              {closeResults.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Results
                  </p>
                  {closeResults.map((r) => (
                    <div
                      key={r.publicKey}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-mono"
                    >
                      {r.status === "pending" && (
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                      )}
                      {r.status === "closing" && (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                      )}
                      {r.status === "closed" && (
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      )}
                      {r.status === "failed" && (
                        <XCircle className="h-3 w-3 text-destructive shrink-0" />
                      )}
                      <span className="shrink-0">
                        <ShortAddress address={r.publicKey} network={settings.network} />
                      </span>
                      <span className="hidden sm:block truncate text-muted-foreground/60">
                        {r.publicKey}
                      </span>
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {r.status === "closed" ? "deleted" : r.status}
                      </span>
                      {r.status === "failed" && r.error && (
                        <span className="text-destructive">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            <CardFooter>
              {!isClosing ? (
                <Button
                  variant="destructive"
                  onClick={handleCloseAccounts}
                  disabled={!closeKeypairsText.trim() || !resolveKey(closeSponsorWalletId, closeSponsorManualKey)}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Close accounts
                </Button>
              ) : (
                <Button variant="outline" onClick={handleStop} className="gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stop
                </Button>
              )}
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ================================================================== */}
      {/* Step 4 — Save to group (parent + children)                         */}
      {/* ================================================================== */}
      <SaveToGroup
        accounts={accounts}
        parentPublicKey={fundedByParentPublicKey ?? parentPublicKey}
        stepNumber={4}
      />
    </div>
  );
}
