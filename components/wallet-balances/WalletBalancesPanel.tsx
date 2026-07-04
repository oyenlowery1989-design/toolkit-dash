"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  Copy,
  Check,
  Search,
  Zap,
  ArrowUp,
  ArrowDown,
  Send,
  KeyRound,
  Eye,
} from "lucide-react";
import { Keypair } from "stellar-sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortAddress } from "@/components/asset-lookup";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useHorizonServer } from "@/hooks/use-horizon-server";
import { useSettings } from "@/lib/settings";
import { formatXlm } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BalanceValue = "loading" | "error" | "unfunded" | number;
type BalanceState = Record<string, BalanceValue>;
type SortField = "balance" | "name" | "key";
type KeyFilter = "all" | "signing" | "watch";

const LOW_BALANCE_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchXlmBalance(
  horizonUrl: string,
  publicKey: string,
  signal?: AbortSignal,
): Promise<number | "error" | "unfunded"> {
  try {
    const res = await fetch(`${horizonUrl}/accounts/${publicKey}`, { signal });
    if (res.status === 404) return "unfunded";
    if (!res.ok) return "error";
    const data = await res.json();
    const xlm = data.balances?.find(
      (b: { asset_type: string }) => b.asset_type === "native",
    )?.balance;
    return xlm ? parseFloat(xlm) : "error";
  } catch {
    return "error";
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function WalletBalancesPanel() {
  const { wallets, addWallet } = useWalletsV2();
  const { folders } = useWalletFolders();
  const { groups } = useAssetGroups();
  const { activeWallet, connect } = useActiveWallet();
  const { url: horizonUrl } = useHorizonServer();
  const { settings } = useSettings();
  const router = useRouter();

  // Balance state
  const [balances, setBalances] = useState<BalanceState>({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Filter
  const [filterMode, setFilterMode] = useState<"all" | "folder" | "group">("all");
  const [filterId, setFilterId] = useState("__all__");
  const [keyFilter, setKeyFilter] = useState<KeyFilter>("all");
  const [search, setSearch] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("balance");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Derived filter string (backward-compatible with existing logic)
  const filter =
    filterMode === "folder" && filterId !== "__all__"
      ? `folder:${filterId}`
      : filterMode === "group" && filterId !== "__all__"
        ? `group:${filterId}`
        : "all";

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add wallet form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newFolderId, setNewFolderId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // Abort controller for in-flight balance fetches
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Balance fetching — dep is walletKeys (stable across renames/reorders)
  // ---------------------------------------------------------------------------

  const walletKeys = useMemo(
    () => wallets.map((w) => w.publicKey).sort().join(","),
    [wallets],
  );

  const fetchAllBalances = useCallback(async () => {
    const keys = wallets.map((w) => w.publicKey);
    if (keys.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const initial: BalanceState = {};
    for (const k of keys) initial[k] = "loading";
    setBalances(initial);

    await Promise.allSettled(
      keys.map(async (publicKey) => {
        const result = await fetchXlmBalance(horizonUrl, publicKey, controller.signal);
        if (controller.signal.aborted) return;
        setBalances((prev) => ({ ...prev, [publicKey]: result }));
      }),
    );
    // wallets excluded intentionally — walletKeys captures membership changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletKeys, horizonUrl]);

  useEffect(() => {
    fetchAllBalances();
    return () => { abortRef.current?.abort(); };
  }, [fetchAllBalances, refreshKey]);

  // ---------------------------------------------------------------------------
  // Per-row retry
  // ---------------------------------------------------------------------------

  async function retrySingle(publicKey: string) {
    setBalances((prev) => ({ ...prev, [publicKey]: "loading" }));
    const result = await fetchXlmBalance(horizonUrl, publicKey);
    setBalances((prev) => ({ ...prev, [publicKey]: result }));
  }

  // ---------------------------------------------------------------------------
  // Precomputed group membership map — O(groups × members) once, not per row
  // ---------------------------------------------------------------------------

  const walletGroupMap = useMemo(() => {
    const map = new Map<string, { groupName: string; role: string }>();
    for (const g of groups) {
      for (const m of g.members) {
        if (!map.has(m.address)) {
          map.set(m.address, { groupName: g.name, role: m.role });
        }
      }
    }
    return map;
  }, [groups]);

  // ---------------------------------------------------------------------------
  // Derived: filtered + sorted wallets
  // ---------------------------------------------------------------------------

  const visibleWallets = wallets.filter((w) => {
    if (filter.startsWith("folder:")) {
      if (w.folderId !== filter.slice(7)) return false;
    } else if (filter.startsWith("group:")) {
      const groupId = filter.slice(6);
      const group = groups.find((g) => g.id === groupId);
      if (!group || !group.members.some((m) => m.address === w.publicKey)) return false;
    }
    if (keyFilter === "signing" && !w.secretKey) return false;
    if (keyFilter === "watch" && !!w.secretKey) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!w.name.toLowerCase().includes(q) && !w.publicKey.toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const sortedWallets = [...visibleWallets].sort((a, b) => {
    if (sortField === "name") {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortField === "key") {
      // signing wallets first (desc) or last (asc)
      const ka = a.secretKey ? 1 : 0;
      const kb = b.secretKey ? 1 : 0;
      return sortDir === "desc" ? kb - ka : ka - kb;
    }
    const ba = typeof balances[a.publicKey] === "number" ? (balances[a.publicKey] as number) : -1;
    const bb = typeof balances[b.publicKey] === "number" ? (balances[b.publicKey] as number) : -1;
    return sortDir === "desc" ? bb - ba : ba - bb;
  });

  const resolvedBalances = visibleWallets
    .map((w) => balances[w.publicKey])
    .filter((v): v is number => typeof v === "number");
  const totalXlm = resolvedBalances.reduce((sum, b) => sum + b, 0);
  const lowCount = resolvedBalances.filter((b) => b < LOW_BALANCE_THRESHOLD).length;
  const loadingCount = visibleWallets.filter(
    (w) => balances[w.publicKey] === undefined || balances[w.publicKey] === "loading",
  ).length;

  // Stats counts — always over all wallets (not filtered) so cards are informational
  const signingCount = wallets.filter((w) => !!w.secretKey).length;
  const watchCount = wallets.length - signingCount;

  // ---------------------------------------------------------------------------
  // Filter mode change
  // ---------------------------------------------------------------------------

  function changeFilterMode(mode: "all" | "folder" | "group") {
    setFilterMode(mode);
    setFilterId("__all__");
  }

  // ---------------------------------------------------------------------------
  // Sort toggle
  // ---------------------------------------------------------------------------

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  }

  // ---------------------------------------------------------------------------
  // Copy with feedback
  // ---------------------------------------------------------------------------

  function handleCopy(walletId: string, publicKey: string) {
    navigator.clipboard.writeText(publicKey).then(
      () => { setCopiedId(walletId); setTimeout(() => setCopiedId(null), 2000); },
      () => { /* clipboard unavailable */ },
    );
  }

  // ---------------------------------------------------------------------------
  // Add wallet (secret key required — watch-only addresses belong in Asset Groups)
  // ---------------------------------------------------------------------------

  async function handleAddWallet() {
    setAddError(null);
    if (!newName.trim()) { setAddError("Name required"); return; }
    if (!newFolderId) { setAddError("Select a folder"); return; }

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(newSecretKey.trim());
    } catch {
      setAddError("Invalid secret key — must start with S and be 56 characters");
      return;
    }

    setAddLoading(true);
    const publicKey = keypair.publicKey();
    setBalances((prev) => ({ ...prev, [publicKey]: "loading" }));
    addWallet(newFolderId, newName.trim(), publicKey, newSecretKey.trim());

    const result = await fetchXlmBalance(horizonUrl, publicKey);
    setBalances((prev) => ({ ...prev, [publicKey]: result }));

    resetForm();
    setAddLoading(false);
  }

  function resetForm() {
    setNewName("");
    setNewSecretKey("");
    setNewFolderId("");
    setAddError(null);
    setShowAddForm(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total XLM</p>
          <p className="text-xl font-bold text-purple-400 mt-0.5">
            {loadingCount > 0 ? "…" : formatXlm(totalXlm)}
          </p>
        </div>
        <button
          onClick={() => setKeyFilter((f) => f === "signing" ? "all" : "signing")}
          className={`bg-card border rounded-lg px-4 py-3 min-w-[100px] text-left transition-colors ${keyFilter === "signing" ? "border-yellow-500/50 bg-yellow-500/5" : "border-border hover:border-yellow-500/30"}`}
        >
          <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <KeyRound className="h-3 w-3 text-yellow-500/70" /> Signing
          </p>
          <p className="text-xl font-bold mt-0.5 text-yellow-500">{signingCount}</p>
        </button>
        <button
          onClick={() => setKeyFilter((f) => f === "watch" ? "all" : "watch")}
          className={`bg-card border rounded-lg px-4 py-3 min-w-[100px] text-left transition-colors ${keyFilter === "watch" ? "border-border bg-muted/30" : "border-border hover:border-border/80"}`}
        >
          <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Eye className="h-3 w-3 text-muted-foreground/50" /> Watch-only
          </p>
          <p className="text-xl font-bold mt-0.5 text-muted-foreground">{watchCount}</p>
        </button>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[100px]">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Low Balance</p>
          <p className={`text-xl font-bold mt-0.5 ${lowCount > 0 ? "text-destructive" : ""}`}>
            {lowCount}
          </p>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loadingCount > 0}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingCount > 0 ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="space-y-2">
        {/* Row 1: filter mode + sub-select + search + add */}
        <div className="flex gap-2 flex-wrap items-center">
          {/* Mode pills */}
          <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
            {(["all", "folder", "group"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => changeFilterMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                  filterMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {mode === "all" ? "All" : mode === "folder" ? "Folder" : "Asset Group"}
              </button>
            ))}
          </div>

          {/* Sub-select for folder or group */}
          {filterMode === "folder" && folders.length > 0 && (
            <Select value={filterId} onValueChange={setFilterId}>
              <SelectTrigger className="w-[180px] h-9 text-sm">
                <SelectValue placeholder="Select folder…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All folders</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filterMode === "group" && groups.length > 0 && (
            <Select value={filterId} onValueChange={setFilterId}>
              <SelectTrigger className="w-[180px] h-9 text-sm">
                <SelectValue placeholder="Select group…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All groups</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filterMode === "folder" && folders.length === 0 && (
            <span className="text-xs text-muted-foreground">No folders yet</span>
          )}
          {filterMode === "group" && groups.length === 0 && (
            <span className="text-xs text-muted-foreground">No asset groups yet</span>
          )}

          <Input
            className="flex-1 min-w-[160px] h-9 text-sm"
            placeholder="Search name or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? "Cancel" : "+ Add Wallet"}
          </Button>
        </div>

        {/* Row 2: sort controls */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-0.5">Sort:</span>
          {(["balance", "name", "key"] as const).map((field) => {
            const active = sortField === field;
            const Icon = active ? (sortDir === "desc" ? ArrowDown : ArrowUp) : ArrowDown;
            const label = field === "balance" ? "XLM Balance" : field === "name" ? "Name" : "With Key";
            return (
              <button
                key={field}
                onClick={() => toggleSort(field)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                {field === "key" && <KeyRound className="h-3 w-3" />}
                {label}
                <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-30"}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Add wallet form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">Add Wallet</p>
          <p className="text-xs text-muted-foreground -mt-1">
            Wallet Manager is for accounts you can sign with. To track an address without a key, add it to an{" "}
            <button className="underline hover:text-foreground transition-colors" onClick={() => router.push("/groups")}>
              Asset Group
            </button>{" "}
            instead.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                placeholder="Hot Wallet"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Folder</Label>
              {folders.length === 0 ? (
                <p className="text-xs text-muted-foreground pt-1.5">
                  No folders yet —{" "}
                  <button
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => router.push("/wallet-manager")}
                  >
                    create one in Wallet Manager
                  </button>
                </p>
              ) : (
                <Select value={newFolderId} onValueChange={setNewFolderId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select folder…" />
                  </SelectTrigger>
                  <SelectContent>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Secret Key</Label>
            <Input
              type="password"
              placeholder="S…"
              value={newSecretKey}
              onChange={(e) => setNewSecretKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddWallet()}
            />
          </div>
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
            <Button size="sm" onClick={handleAddWallet} disabled={addLoading || folders.length === 0}>
              {addLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save Wallet
            </Button>
          </div>
        </div>
      )}

      {/* Empty states */}
      {wallets.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No wallets saved yet. Add wallets in the Wallet Manager.
        </p>
      )}
      {visibleWallets.length === 0 && wallets.length > 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          No wallets match the current filter.
        </p>
      )}

      {/* Table */}
      {wallets.length > 0 && sortedWallets.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[1fr_140px_180px_110px_100px] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/30 min-w-[640px]">
              <span>Name</span>
              <span>Address</span>
              <span>Folder / Group</span>
              <span className="text-right">XLM</span>
              <span />
            </div>

            {sortedWallets.map((wallet) => {
              const bal = balances[wallet.publicKey];
              const isActive = activeWallet?.id === wallet.id;
              const isLow = typeof bal === "number" && bal < LOW_BALANCE_THRESHOLD;
              const hasSecretKey = !!wallet.secretKey;
              const isCopied = copiedId === wallet.id;
              const groupInfo = walletGroupMap.get(wallet.publicKey);
              const folder = folders.find((f) => f.id === wallet.folderId);

              return (
                <div
                  key={wallet.id}
                  className={`grid grid-cols-[1fr_140px_180px_110px_100px] gap-3 px-4 py-2.5 items-center border-b border-border last:border-0 text-sm transition-colors min-w-[640px] ${
                    isActive ? "bg-purple-500/5" : isLow ? "bg-destructive/5" : "hover:bg-muted/20"
                  }`}
                >
                  {/* Name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${isActive ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                    <span className={`truncate font-medium ${isLow ? "text-destructive" : ""}`}>
                      {wallet.name}
                    </span>
                    {isActive && (
                      <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">
                        active
                      </span>
                    )}
                    {hasSecretKey ? (
                      <span title="Secret key saved — can sign transactions">
                        <KeyRound className="h-3 w-3 shrink-0 text-yellow-500/70" />
                      </span>
                    ) : (
                      <span title="Watch-only — no secret key">
                        <Eye className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      </span>
                    )}
                  </div>

                  {/* Address */}
                  <span className="text-muted-foreground font-mono text-xs">
                    <ShortAddress address={wallet.publicKey} network={settings.network} />
                  </span>

                  {/* Folder + Group — both shown */}
                  <div className="text-xs truncate leading-tight">
                    {groupInfo && (
                      <div className="text-foreground/80">
                        {groupInfo.groupName}
                        <span className="ml-1 px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 uppercase text-[10px]">
                          {groupInfo.role}
                        </span>
                      </div>
                    )}
                    <div className={groupInfo ? "text-muted-foreground/60 text-[11px] mt-0.5" : "text-muted-foreground"}>
                      {folder?.name ?? "—"}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="text-right">
                    {bal === undefined || bal === "loading" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                    ) : bal === "unfunded" ? (
                      <button
                        className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                        onClick={() => retrySingle(wallet.publicKey)}
                        title="Account not yet funded — click to retry"
                      >
                        unfunded
                      </button>
                    ) : bal === "error" ? (
                      <button
                        className="text-xs text-destructive/70 hover:text-destructive transition-colors"
                        onClick={() => retrySingle(wallet.publicKey)}
                        title="Click to retry"
                      >
                        error ↺
                      </button>
                    ) : (
                      <span className={`font-mono font-semibold ${isLow ? "text-destructive" : "text-purple-400"}`}>
                        {formatXlm(bal as number)}
                        {isLow && <span className="ml-1.5 text-xs">⚠</span>}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      title={isCopied ? "Copied!" : "Copy address"}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => handleCopy(wallet.id, wallet.publicKey)}
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    {!isActive && (
                      <button
                        title="Connect as active wallet"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => connect(wallet.id)}
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      title="Investigate address"
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => router.push(`/address-investigator?address=${wallet.publicKey}`)}
                    >
                      <Search className="h-3.5 w-3.5" />
                    </button>
                    {hasSecretKey && (
                      <button
                        title="Go to Payments"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => router.push("/payments")}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
