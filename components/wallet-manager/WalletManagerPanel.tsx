"use client";

import { useState } from "react";
import { Keypair } from "stellar-sdk";
import {
  Folder, FolderOpen, Plus, Pencil, Trash2,
  Wallet, Eye, EyeOff, CheckCircle2, LogOut,
} from "lucide-react";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { shortAddr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WalletFolder } from "@/hooks/use-wallet-folders";
import type { WalletEntry } from "@/hooks/use-wallets-v2";

// ---------------------------------------------------------------------------
// Add-wallet inline form
// ---------------------------------------------------------------------------

function AddWalletForm({ folderId, onDone }: { folderId: string; onDone: () => void }) {
  const { addWallet } = useWalletsV2();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleSubmit() {
    setErr(null);
    if (!name.trim()) { setErr("Name is required."); return; }
    let pub: string;
    try {
      pub = Keypair.fromSecret(secret.trim()).publicKey();
    } catch {
      setErr("Invalid secret key.");
      return;
    }
    addWallet(folderId, name.trim(), pub, secret.trim());
    setName(""); setSecret(""); setErr(null);
    onDone();
  }

  // Fix 5 — named variable instead of IIFE
  let derivedPub: string | null = null;
  if (secret.length > 4) {
    try { derivedPub = Keypair.fromSecret(secret.trim()).publicKey(); } catch { /* invalid */ }
  }

  return (
    <div className="rounded-md border border-border p-4 space-y-3 bg-muted/30">
      <p className="text-sm font-medium">Add Wallet</p>
      <div className="space-y-2">
        <Label htmlFor="wallet-name">Name</Label>
        <Input
          id="wallet-name"
          placeholder="e.g. Main Account"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
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
        {derivedPub && <p className="text-xs text-muted-foreground font-mono">{shortAddr(derivedPub)}</p>}
      </div>
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

function WalletRow({ wallet }: { wallet: WalletEntry }) {
  const { activeWallet, connect, disconnect } = useActiveWallet();
  const { renameWallet, removeWallet } = useWalletsV2();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(wallet.name);
  const isActive = activeWallet?.id === wallet.id;

  // Fix 4 — don't close if blank
  function handleRename() {
    if (!editName.trim()) return;
    renameWallet(wallet.id, editName.trim());
    setEditing(false);
  }

  return (
    <div className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors ${
      isActive ? "border-green-500/50 bg-green-500/5" : "border-border hover:bg-muted/30"
    }`}>
      <Wallet className={`h-4 w-4 shrink-0 ${isActive ? "text-green-500" : "text-muted-foreground"}`} />

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
          <>
            <p className="font-medium truncate">{wallet.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{shortAddr(wallet.publicKey)}</p>
          </>
        )}
      </div>

      {isActive && (
        <span className="flex items-center gap-1 text-xs text-green-500 font-medium shrink-0">
          <CheckCircle2 className="h-3 w-3" /> Connected
        </span>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {isActive ? (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={disconnect} title="Disconnect">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => connect(wallet.id)}>
            Connect
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing((v) => !v)} title="Rename">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {/* Fix 1 — confirm before delete */}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive/70 hover:text-destructive"
          onClick={() => {
            if (window.confirm(`Delete wallet "${wallet.name}"? This cannot be undone.`)) {
              removeWallet(wallet.id);
            }
          }}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
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

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [addingWallet, setAddingWallet] = useState(false);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? folders[0] ?? null;
  const folderWallets = wallets.filter((w) => w.folderId === selectedFolder?.id);

  // Fix 7 — plain functions, no useCallback
  function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const id = createFolder(newFolderName.trim());
    setNewFolderName("");
    setAddingFolder(false);
    setSelectedFolderId(id);
  }

  // Fix 4 — don't close if blank; Fix 7 — plain function
  function handleRenameFolder(folder: WalletFolder) {
    if (!editFolderName.trim()) return;
    renameFolder(folder.id, editFolderName.trim());
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
            const count = wallets.filter((w) => w.folderId === folder.id).length;
            const hasActive = wallets.some(
              (w) => w.folderId === folder.id && w.id === activeWallet?.id,
            );
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
                  // Fix 2 — outer <div> instead of <button> to avoid nested buttons
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
                    <span className="text-xs text-muted-foreground shrink-0">{count}</span>
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
                      {/* Fix 1 — confirm before folder delete */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete folder "${folder.name}" and all its wallets? This cannot be undone.`)) {
                            deleteFolder(folder.id);
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
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setAddingWallet(true)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Wallet
              </Button>
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
                  onDone={() => setAddingWallet(false)}
                />
              )}
              {folderWallets.length === 0 && !addingWallet && (
                <p className="text-sm text-muted-foreground">
                  No wallets in this folder. Click "Add Wallet" to add one.
                </p>
              )}
              {folderWallets.map((w) => (
                <WalletRow key={w.id} wallet={w} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
