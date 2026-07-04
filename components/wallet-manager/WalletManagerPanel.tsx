"use client";

import { useState, useEffect } from "react";
import { Keypair, Horizon } from "stellar-sdk";
import {
  Folder, FolderOpen, Plus, Pencil, Trash2,
  Eye, EyeOff, CheckCircle2, LogOut, Copy, Check, KeyRound,
  ExternalLink, ArrowRightLeft,
} from "lucide-react";
import { StrKey } from "stellar-sdk";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useAddressBook } from "@/hooks/use-address-book";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { shortAddr } from "@/lib/format";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WalletFolder } from "@/hooks/use-wallet-folders";
import type { WalletEntry } from "@/hooks/use-wallets-v2";

// ---------------------------------------------------------------------------
// Add-wallet inline form
// ---------------------------------------------------------------------------

function AddWalletForm({ folderId, onDone, prefillPub }: { folderId: string; onDone: () => void; prefillPub?: string }) {
  const { addWallet, wallets } = useWalletsV2();
  const { folders } = useWalletFolders();
  const { entries: abEntries } = useAddressBook();
  const { groups } = useAssetGroups();
  const [name, setName] = useState("");
  const [watchOnly, setWatchOnly] = useState(!!prefillPub);
  const [secret, setSecret] = useState("");
  const [pubInput, setPubInput] = useState(prefillPub ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Derive current pub for live warnings
  let currentPub: string | null = null;
  if (watchOnly) {
    if (StrKey.isValidEd25519PublicKey(pubInput.trim())) currentPub = pubInput.trim();
  } else if (secret.length > 4) {
    try { currentPub = Keypair.fromSecret(secret.trim()).publicKey(); } catch { /* invalid */ }
  }
  const abMatch = currentPub ? abEntries.find((e) => e.publicKey === currentPub) : null;
  const groupMatch = currentPub
    ? groups.flatMap((g) => g.members.filter((m) => m.address === currentPub).map((m) => ({ group: g, member: m })))
    : [];

  function handleSubmit() {
    setErr(null);
    if (!name.trim()) { setErr("Name is required."); return; }
    if (watchOnly) {
      if (!StrKey.isValidEd25519PublicKey(pubInput.trim())) { setErr("Invalid public key."); return; }
      const existing = wallets.find((w) => w.publicKey === pubInput.trim());
      if (existing) {
        const folder = folders.find((f) => f.id === existing.folderId);
        setErr(`Already saved as "${existing.name}"${folder ? ` in folder "${folder.name}"` : ""}.`);
        return;
      }
      addWallet(folderId, name.trim(), pubInput.trim(), "");
    } else {
      let pub: string;
      try { pub = Keypair.fromSecret(secret.trim()).publicKey(); }
      catch { setErr("Invalid secret key."); return; }
      const existing = wallets.find((w) => w.publicKey === pub);
      if (existing) {
        const folder = folders.find((f) => f.id === existing.folderId);
        setErr(`Already saved as "${existing.name}"${folder ? ` in folder "${folder.name}"` : ""}.`);
        return;
      }
      addWallet(folderId, name.trim(), pub, secret.trim());
    }
    toast.success("Wallet added");
    setName(""); setSecret(""); setPubInput(""); setErr(null);
    onDone();
  }

  return (
    <div className="rounded-md border border-border p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Add Wallet</p>
        <div className="flex items-center gap-1 rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => { setWatchOnly(false); setErr(null); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 transition-colors ${!watchOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <KeyRound className="h-3 w-3" /> Full
          </button>
          <button
            type="button"
            onClick={() => { setWatchOnly(true); setErr(null); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 transition-colors ${watchOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Eye className="h-3 w-3" /> Watch only
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="wallet-name">Name</Label>
        <Input
          id="wallet-name"
          placeholder="e.g. Main Account"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {watchOnly ? (
        <div className="space-y-2">
          <Label htmlFor="wallet-pub">Public Key</Label>
          <Input
            id="wallet-pub"
            placeholder="G…"
            value={pubInput}
            onChange={(e) => setPubInput(e.target.value)}
            className="font-mono text-xs"
            autoComplete="off"
          />
          {StrKey.isValidEd25519PublicKey(pubInput.trim()) && (
            <p className="text-xs text-muted-foreground font-mono">{shortAddr(pubInput.trim())}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="wallet-secret">Secret Key</Label>
          <div className="relative">
            <Input
              id="wallet-secret"
              type={showSecret ? "text" : "password"}
              placeholder="S…"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="font-mono text-xs pr-10"
              autoComplete="off"
            />
            <button
              type="button"
              aria-label={showSecret ? "Hide secret key" : "Show secret key"}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {currentPub && <p className="text-xs text-muted-foreground font-mono">{shortAddr(currentPub)}</p>}
        </div>
      )}
      {abMatch && (
        <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
          In Address Book as &quot;{abMatch.label}&quot; — you can still add it here.
        </p>
      )}
      {groupMatch.length > 0 && (
        <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
          In {groupMatch.length === 1
            ? `group "${groupMatch[0].group.name}" as ${groupMatch[0].member.role}`
            : `${groupMatch.length} groups: ${groupMatch.map((m) => `"${m.group.name}"`).join(", ")}`
          } — you can still add it here.
        </p>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit}>Add</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wallet row
// ---------------------------------------------------------------------------

function WalletRow({ wallet, allFolders }: { wallet: WalletEntry; allFolders: WalletFolder[] }) {
  const { activeWallet, connect, disconnect } = useActiveWallet();
  const { renameWallet, moveWallet, removeWallet } = useWalletsV2();
  const { settings } = useSettings();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(wallet.name);
  const [showSecret, setShowSecret] = useState(false);
  const [copiedField, setCopiedField] = useState<"pub" | "secret" | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [movingTo, setMovingTo] = useState<string>("");
  const [showMove, setShowMove] = useState(false);
  const isActive = activeWallet?.id === wallet.id;
  const isWatchOnly = !wallet.secretKey;

  const horizonUrl = resolveHorizonUrl(settings);

  // Lazy-load balance when row is rendered
  useEffect(() => {
    const server = new Horizon.Server(horizonUrl);
    server.loadAccount(wallet.publicKey)
      .then((acc: { balances: Array<{ asset_type: string; balance: string }> }) => {
        const native = acc.balances.find((b) => b.asset_type === "native");
        setBalance(native ? parseFloat(native.balance).toFixed(2) : "0.00");
      })
      .catch(() => setBalance(null));
  }, [wallet.publicKey, horizonUrl]);

  function handleRename() {
    if (!editName.trim()) return;
    renameWallet(wallet.id, editName.trim());
    toast.success("Wallet renamed");
    setEditing(false);
  }

  function copyField(field: "pub" | "secret") {
    const value = field === "pub" ? wallet.publicKey : wallet.secretKey;
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  function handleMove() {
    if (!movingTo || movingTo === wallet.folderId) { setShowMove(false); return; }
    moveWallet(wallet.id, movingTo);
    toast.success("Wallet moved");
    setShowMove(false);
  }

  const explorerBase = settings.network === "testnet" ? "https://stellar.expert/explorer/testnet" : "https://stellar.expert/explorer/public";
  const otherFolders = allFolders.filter((f) => f.id !== wallet.folderId);

  return (
    <div className={`rounded-md border px-3 py-2.5 text-sm transition-colors ${
      isActive ? "border-green-500/50 bg-green-500/5" : "border-border hover:bg-muted/30"
    }`}>
      <div className="flex items-center gap-3">
        {isWatchOnly
          ? <span title="Watch only"><Eye className={`h-4 w-4 shrink-0 ${isActive ? "text-green-500" : "text-muted-foreground"}`} /></span>
          : <span title="Full wallet"><KeyRound className={`h-4 w-4 shrink-0 ${isActive ? "text-green-500" : "text-muted-foreground"}`} /></span>
        }

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex gap-2 items-center">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-6 text-xs py-0 px-2 w-40"
                autoFocus
              />
              <Button size="sm" className="h-6 px-2 text-xs" onClick={handleRename}>Save</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0">
                <p className="font-medium truncate">{wallet.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{shortAddr(wallet.publicKey)}</p>
              </div>
              {balance !== null && (
                <span className="text-xs text-muted-foreground font-mono shrink-0">{balance} XLM</span>
              )}
            </div>
          )}
        </div>

        {isActive && (
          <span className="flex items-center gap-1 text-xs text-green-500 font-medium shrink-0">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {/* Always-visible copy public key */}
          <button
            type="button"
            onClick={() => copyField("pub")}
            className="flex items-center rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy public key"
          >
            {copiedField === "pub" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {/* Stellar.Expert link */}
          <a
            href={`${explorerBase}/account/${wallet.publicKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View on Stellar.Expert"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {isActive ? (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={disconnect} title="Disconnect">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => connect(wallet.id)}>
              Connect
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing((v) => !v); setShowSecret(false); setShowMove(false); }} title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {otherFolders.length > 0 && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setShowMove((v) => !v); setEditing(false); }} title="Move to folder">
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive/70 hover:text-destructive"
            onClick={() => {
              if (window.confirm(`Delete wallet "${wallet.name}"? This cannot be undone.`)) {
                removeWallet(wallet.id);
                toast.success("Wallet deleted");
              }
            }}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {showMove && (
        <div className="mt-3 border-t border-border pt-3 flex items-center gap-2">
          <p className="text-xs text-muted-foreground shrink-0">Move to:</p>
          <select
            value={movingTo || wallet.folderId}
            onChange={(e) => setMovingTo(e.target.value)}
            className="flex-1 h-7 rounded border border-border bg-background text-xs px-2"
          >
            {otherFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleMove}>Move</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowMove(false)}>Cancel</Button>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Public Key</p>
              <p className="text-xs font-mono text-foreground break-all">{wallet.publicKey}</p>
            </div>
            <button
              type="button"
              onClick={() => copyField("pub")}
              className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
            >
              {copiedField === "pub" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedField === "pub" ? "Copied!" : "Copy"}
            </button>
          </div>

          {isWatchOnly ? (
            <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
              <Eye className="h-3 w-3" /> Watch only — no secret key stored
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Secret Key</p>
                <p className="text-xs font-mono text-foreground break-all">
                  {showSecret ? wallet.secretKey : "S" + "•".repeat(55)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showSecret ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  onClick={() => copyField("secret")}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  {copiedField === "secret" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedField === "secret" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function WalletManagerPanel() {
  const { folders, createFolder, renameFolder, deleteFolder } = useWalletFolders();
  const { wallets } = useWalletsV2();
  const { activeWallet } = useActiveWallet();
  const { entries: abEntries } = useAddressBook();

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [addingWallet, setAddingWallet] = useState(false);
  const [addPrefillPub, setAddPrefillPub] = useState<string | undefined>(undefined);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? folders[0] ?? null;
  const folderWallets = wallets.filter((w) => w.folderId === selectedFolder?.id);

  // Address book entries not yet in wallets (for quick-add)
  const walletPubKeys = new Set(wallets.map((w) => w.publicKey));
  const abNotInWallets = abEntries.filter((e) => !walletPubKeys.has(e.publicKey));

  function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const id = createFolder(newFolderName.trim());
    toast.success("Folder created");
    setNewFolderName("");
    setAddingFolder(false);
    setSelectedFolderId(id);
  }

  function handleRenameFolder(folder: WalletFolder) {
    if (!editFolderName.trim()) return;
    renameFolder(folder.id, editFolderName.trim());
    toast.success("Folder renamed");
    setEditingFolderId(null);
  }

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 min-h-[400px]">
      {/* Folder list */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Folders</CardTitle>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setAddingFolder(true)}
              title="New folder"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-1 p-2">
          {addingFolder && (
            <div className="flex gap-1 p-1">
              <Input
                placeholder="Folder name…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") setAddingFolder(false);
                }}
                className="h-7 text-xs"
                autoFocus
              />
              <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={handleCreateFolder}>
                Add
              </Button>
            </div>
          )}

          {folders.length === 0 && !addingFolder && (
            <p className="text-xs text-muted-foreground p-2">
              No folders yet. Create one to get started.
            </p>
          )}

          {folders.map((folder) => {
            const isSelected = folder.id === selectedFolder?.id;
            const fw = wallets.filter((w) => w.folderId === folder.id);
            const fullCount = fw.filter((w) => w.secretKey).length;
            const watchCount = fw.filter((w) => !w.secretKey).length;
            const hasActive = fw.some((w) => w.id === activeWallet?.id);
            return (
              <div key={folder.id}>
                {editingFolderId === folder.id ? (
                  <div className="flex gap-1 p-1">
                    <Input
                      value={editFolderName}
                      onChange={(e) => setEditFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameFolder(folder);
                        if (e.key === "Escape") setEditingFolderId(null);
                      }}
                      className="h-7 text-xs"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => handleRenameFolder(folder)}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <div
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors group cursor-pointer ${
                      isSelected ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    {isSelected ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{folder.name}</span>
                    {hasActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                    )}
                    <span
                      className="text-xs text-muted-foreground shrink-0"
                      title={`${fullCount} full, ${watchCount} watch-only`}
                    >
                      {fullCount > 0 && <span className="inline-flex items-center gap-0.5"><KeyRound className="h-2.5 w-2.5" />{fullCount}</span>}
                      {fullCount > 0 && watchCount > 0 && <span className="mx-0.5 opacity-40">·</span>}
                      {watchCount > 0 && <span className="inline-flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{watchCount}</span>}
                    </span>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditFolderName(folder.name);
                          setEditingFolderId(folder.id);
                        }}
                        className="rounded p-0.5 hover:bg-muted"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete folder "${folder.name}" and all its wallets? This cannot be undone.`)) {
                            deleteFolder(folder.id);
                            toast.success("Folder deleted");
                            if (selectedFolder?.id === folder.id) setSelectedFolderId(null);
                          }
                        }}
                        className="rounded p-0.5 hover:bg-muted text-destructive/70 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Wallet list */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              {selectedFolder ? selectedFolder.name : "Select a folder"}
            </CardTitle>
            {selectedFolder && (
              <div className="flex items-center gap-2">
                {abNotInWallets.length > 0 && (
                  <select
                    className="h-7 rounded border border-border bg-background text-xs px-2 text-muted-foreground"
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setAddPrefillPub(e.target.value);
                      setAddingWallet(true);
                    }}
                    title="Quick-add from Address Book"
                  >
                    <option value="">+ From Address Book</option>
                    {abNotInWallets.map((e) => (
                      <option key={e.publicKey} value={e.publicKey}>{e.label} ({shortAddr(e.publicKey)})</option>
                    ))}
                  </select>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => { setAddPrefillPub(undefined); setAddingWallet(true); }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Wallet
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-2 p-4">
          {!selectedFolder ? (
            <p className="text-sm text-muted-foreground">
              {folders.length === 0
                ? "Create a folder first, then add wallets to it."
                : "Select a folder on the left."}
            </p>
          ) : (
            <>
              {addingWallet && (
                <AddWalletForm
                  folderId={selectedFolder.id}
                  prefillPub={addPrefillPub}
                  onDone={() => { setAddingWallet(false); setAddPrefillPub(undefined); }}
                />
              )}
              {folderWallets.length === 0 && !addingWallet && (
                <p className="text-sm text-muted-foreground">
                  No wallets in this folder. Click &quot;Add Wallet&quot; to add one.
                </p>
              )}
              {folderWallets.map((w) => (
                <WalletRow key={w.id} wallet={w} allFolders={folders} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
