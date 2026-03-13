# Wallet Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Wallet Manager that lets the user save named wallets (with secret keys) organised into folders, switch between them via a header dropdown, and have the active wallet auto-supply the secret key in Bulk Payments and Ghost Payments.

**Architecture:** Three new DB tables (`wallet_folders`, `wallets`, `app_state`). Two new hooks (`useWalletFolders` + `useActiveWallet`) using the existing `createDbCache` pattern. Active wallet ID also mirrored to `localStorage` for instant reactivation on page load without a DB round-trip. Signing modules read `useActiveWallet()` instead of holding their own secret key field.

**Tech Stack:** Next.js App Router, SQLite via `better-sqlite3`, existing `createDbCache`/`dbPost`/`dbPatch`/`dbDelete` helpers, shadcn/ui, lucide-react.

---

### Task 1: DB schema — add wallet_folders, wallets, app_state tables

**Files:**
- Modify: `lib/db.ts`

**Context:**
`lib/db.ts` exports `getDb()` which returns a singleton `better-sqlite3` instance. All tables are created in a single `db.exec(...)` call near the top of `getDb()`. The existing `wallets` table (`public_key TEXT PRIMARY KEY, label TEXT NOT NULL`) must be **dropped and replaced** — it stored no secret key and had a flat structure. Add the three new tables after the existing ones.

**Step 1: Open `lib/db.ts` and locate the `CREATE TABLE IF NOT EXISTS wallets` block (around line 61). Replace it and add the new tables:**

```ts
// REMOVE this block entirely:
// CREATE TABLE IF NOT EXISTS wallets (
//   public_key  TEXT PRIMARY KEY,
//   label       TEXT NOT NULL
// );

// ADD these three tables instead (append after the asset_group_members table):
    CREATE TABLE IF NOT EXISTS wallet_folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id          TEXT PRIMARY KEY,
      folder_id   TEXT NOT NULL REFERENCES wallet_folders(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      public_key  TEXT NOT NULL,
      secret_key  TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL
    );
```

**Step 2: Verify types compile:**
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```
Expected: no new errors in `lib/db.ts`.

---

### Task 2: API routes for wallet_folders and wallets

**Files:**
- Create: `app/api/db/wallet-folders/route.ts`
- Create: `app/api/db/wallets-v2/route.ts`
- Modify: `app/api/db/wallets/route.ts` — replace body to work with new schema

**Context:**
Existing API pattern: each route exports `GET` (returns all rows) and `POST`/`PATCH`/`DELETE` (write operations). Look at `app/api/db/groups/route.ts` for a good reference — it handles `type: "group" | "member"` discriminated bodies.

`wallet_folders` route needs: GET all folders, POST create, PATCH rename, DELETE by id.
`wallets-v2` route needs: GET all wallets (join folder), POST create, PATCH update name, DELETE by id.

**Step 1: Create `app/api/db/wallet-folders/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, name, position FROM wallet_folders ORDER BY position ASC, name ASC"
  ).all() as { id: string; name: string; position: number }[];
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const db = getDb();
  const { id, name, position = 0 } = await req.json() as {
    id: string; name: string; position?: number;
  };
  db.prepare(
    "INSERT INTO wallet_folders (id, name, position) VALUES (?, ?, ?)"
  ).run(id, name, position);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const db = getDb();
  const { id, name } = await req.json() as { id: string; name: string };
  db.prepare("UPDATE wallet_folders SET name = ? WHERE id = ?").run(name, id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const db = getDb();
  const { id } = await req.json() as { id: string };
  // CASCADE deletes wallets in the folder
  db.prepare("DELETE FROM wallet_folders WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
```

**Step 2: Create `app/api/db/wallets-v2/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, folder_id, name, public_key, secret_key, position FROM wallets ORDER BY position ASC, name ASC"
  ).all() as {
    id: string; folder_id: string; name: string;
    public_key: string; secret_key: string; position: number;
  }[];
  // camelCase for the client
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      folderId: r.folder_id,
      name: r.name,
      publicKey: r.public_key,
      secretKey: r.secret_key,
      position: r.position,
    }))
  );
}

export async function POST(req: Request) {
  const db = getDb();
  const { id, folderId, name, publicKey, secretKey, position = 0 } =
    await req.json() as {
      id: string; folderId: string; name: string;
      publicKey: string; secretKey: string; position?: number;
    };
  db.prepare(
    "INSERT INTO wallets (id, folder_id, name, public_key, secret_key, position) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, folderId, name, publicKey, secretKey, position);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const db = getDb();
  const { id, name } = await req.json() as { id: string; name: string };
  db.prepare("UPDATE wallets SET name = ? WHERE id = ?").run(name, id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const db = getDb();
  const { id } = await req.json() as { id: string };
  db.prepare("DELETE FROM wallets WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
```

**Step 3: Create `app/api/db/app-state/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM app_state").all() as {
    key: string; value: string;
  }[];
  // Return as a flat object { key: value }
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const db = getDb();
  const { key, value } = await req.json() as { key: string; value: string };
  db.prepare(
    "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
  return NextResponse.json({ ok: true });
}
```

**Step 4: Compile check:**
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

---

### Task 3: Hooks — useWalletFolders, useWallets, useActiveWallet

**Files:**
- Create: `hooks/use-wallet-folders.ts`
- Create: `hooks/use-wallets-v2.ts`
- Create: `hooks/use-active-wallet.ts`
- Modify: `hooks/use-wallets.ts` — replace entire file (old hook, no longer used)

**Context:**
The existing `hooks/use-wallets.ts` used a different DB shape. It will be replaced. The new hooks follow the `createDbCache` pattern from `lib/db-client.ts`.

`useActiveWallet` is special: it does NOT use `createDbCache` (there's no array to cache). It stores the active wallet ID in `localStorage` as `"active_wallet_id"` for instant reads, and persists it to DB (`app_state`) for durability. The active wallet object is derived by looking up the ID in the `useWallets` cache.

**Step 1: Create `hooks/use-wallet-folders.ts`:**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, dbDelete } from "@/lib/db-client";

export interface WalletFolder {
  id: string;
  name: string;
  position: number;
}

const ENDPOINT = "/api/db/wallet-folders";
const _cache = createDbCache<WalletFolder>();

export function useWalletFolders() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    return unsub;
  }, []);

  const folders = _cache.get();

  const createFolder = useCallback((name: string) => {
    const id = crypto.randomUUID();
    const position = _cache.get().length;
    const entry: WalletFolder = { id, name, position };
    _cache.set([..._cache.get(), entry]);
    dbPost(ENDPOINT, entry);
    return id;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((f) => (f.id === id ? { ...f, name } : f)));
    dbPatch(ENDPOINT, { id, name });
  }, []);

  const deleteFolder = useCallback((id: string) => {
    _cache.set(_cache.get().filter((f) => f.id !== id));
    dbDelete(ENDPOINT, id);
  }, []);

  return { folders, createFolder, renameFolder, deleteFolder };
}
```

**Step 2: Create `hooks/use-wallets-v2.ts`:**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, dbDelete } from "@/lib/db-client";

export interface WalletEntry {
  id: string;
  folderId: string;
  name: string;
  publicKey: string;
  secretKey: string;
  position: number;
}

const ENDPOINT = "/api/db/wallets-v2";
const _cache = createDbCache<WalletEntry>();

export function useWalletsV2() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    const onFocus = () => _cache.reload(ENDPOINT);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const wallets = _cache.get();

  const addWallet = useCallback(
    (folderId: string, name: string, publicKey: string, secretKey: string) => {
      const id = crypto.randomUUID();
      const position = _cache.get().filter((w) => w.folderId === folderId).length;
      const entry: WalletEntry = { id, folderId, name, publicKey, secretKey, position };
      _cache.set([..._cache.get(), entry]);
      dbPost(ENDPOINT, entry);
      return id;
    },
    []
  );

  const renameWallet = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((w) => (w.id === id ? { ...w, name } : w)));
    dbPatch(ENDPOINT, { id, name });
  }, []);

  const removeWallet = useCallback((id: string) => {
    _cache.set(_cache.get().filter((w) => w.id !== id));
    dbDelete(ENDPOINT, id);
  }, []);

  return { wallets, addWallet, renameWallet, removeWallet };
}
```

**Step 3: Create `hooks/use-active-wallet.ts`:**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { useWalletsV2 } from "./use-wallets-v2";

const LS_KEY = "active_wallet_id";
const STATE_ENDPOINT = "/api/db/app-state";

// Module-level so all hook instances share the same state
let _activeId: string | null =
  typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
const _listeners = new Set<() => void>();

function notifyAll() {
  _listeners.forEach((fn) => fn());
}

export function setActiveWalletId(id: string | null) {
  _activeId = id;
  if (typeof localStorage !== "undefined") {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  }
  // Persist to DB (fire and forget)
  fetch(STATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: LS_KEY, value: id ?? "" }),
  }).catch(() => {});
  notifyAll();
}

export function useActiveWallet() {
  const [, rerender] = useState(0);
  const { wallets } = useWalletsV2();

  useEffect(() => {
    _listeners.add(rerender.bind(null, (n: number) => n + 1));
    // On first mount, reconcile localStorage vs DB
    fetch(STATE_ENDPOINT)
      .then((r) => r.json())
      .then((state: Record<string, string>) => {
        const dbId = state[LS_KEY] ?? null;
        if (dbId && dbId !== _activeId) {
          _activeId = dbId;
          if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, dbId);
          notifyAll();
        }
      })
      .catch(() => {});
    return () => {
      _listeners.delete(rerender.bind(null, (n: number) => n + 1));
    };
  }, []);

  const activeWallet = wallets.find((w) => w.id === _activeId) ?? null;

  const connect = useCallback((id: string) => setActiveWalletId(id), []);
  const disconnect = useCallback(() => setActiveWalletId(null), []);

  return { activeWallet, activeId: _activeId, connect, disconnect };
}
```

**Note on listener cleanup:** The `useEffect` cleanup above has a bug because `rerender.bind` creates a new function reference each time. Fix by using a stable ref:

Replace the `useEffect` body with:
```ts
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    _listeners.add(fn);
    fetch(STATE_ENDPOINT)
      .then((r) => r.json())
      .then((state: Record<string, string>) => {
        const dbId = state[LS_KEY] ?? null;
        if (dbId && dbId !== _activeId) {
          _activeId = dbId;
          if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, dbId);
          notifyAll();
        }
      })
      .catch(() => {});
    return () => _listeners.delete(fn);
  }, []);
```

**Step 4: Replace `hooks/use-wallets.ts`** with a re-export stub so any existing import doesn't break at compile time:

```ts
// Replaced by use-wallets-v2. Re-exported for backwards compat.
export { useWalletsV2 as useWallets } from "./use-wallets-v2";
export type { WalletEntry } from "./use-wallets-v2";
```

**Step 5: Compile check:**
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

---

### Task 4: Wallet Manager page

**Files:**
- Create: `components/wallet-manager/WalletManagerPanel.tsx`
- Create: `app/(tools)/wallet-manager/page.tsx` (may already exist as stub — overwrite)

**Context:**
The navigation already has a "Wallet Manager" entry pointing to `/wallet-manager`. Check if `app/(tools)/wallet-manager/page.tsx` exists — if it does, replace it. The panel has two columns: left = folder list, right = wallets in selected folder.

**Step 1: Create `components/wallet-manager/WalletManagerPanel.tsx`:**

```tsx
"use client";

import { useState, useCallback } from "react";
import { Keypair } from "stellar-sdk";
import { Folder, FolderOpen, Plus, Pencil, Trash2, Wallet, Eye, EyeOff, CheckCircle2, LogOut } from "lucide-react";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WalletFolder } from "@/hooks/use-wallet-folders";
import type { WalletEntry } from "@/hooks/use-wallets-v2";

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

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

  return (
    <div className="rounded-md border border-border p-4 space-y-3 bg-muted/30">
      <p className="text-sm font-medium">Add Wallet</p>
      <div className="space-y-2">
        <Label htmlFor="wallet-name">Name</Label>
        <Input id="wallet-name" placeholder="e.g. Main Account" value={name} onChange={(e) => setName(e.target.value)} />
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
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowSecret((v) => !v)}
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {secret.length > 4 && (() => {
          try {
            const pub = Keypair.fromSecret(secret.trim()).publicKey();
            return <p className="text-xs text-muted-foreground font-mono">{shortAddr(pub)}</p>;
          } catch { return null; }
        })()}
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

  function handleRename() {
    if (editName.trim()) renameWallet(wallet.id, editName.trim());
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
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(false); }}
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
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive/70 hover:text-destructive" onClick={() => removeWallet(wallet.id)} title="Delete">
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

  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    const id = createFolder(newFolderName.trim());
    setNewFolderName("");
    setAddingFolder(false);
    setSelectedFolderId(id);
  }, [newFolderName, createFolder]);

  const handleRenameFolder = useCallback((folder: WalletFolder) => {
    if (editFolderName.trim()) renameFolder(folder.id, editFolderName.trim());
    setEditingFolderId(null);
  }, [editFolderName, renameFolder]);

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 h-full min-h-[400px]">
      {/* Folder list */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Folders</CardTitle>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAddingFolder(true)} title="New folder">
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
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setAddingFolder(false); }}
                className="h-7 text-xs"
                autoFocus
              />
              <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={handleCreateFolder}>Add</Button>
            </div>
          )}

          {folders.length === 0 && !addingFolder && (
            <p className="text-xs text-muted-foreground p-2">No folders yet. Create one to get started.</p>
          )}

          {folders.map((folder) => {
            const isSelected = folder.id === selectedFolder?.id;
            const count = wallets.filter((w) => w.folderId === folder.id).length;
            const hasActive = wallets.some((w) => w.folderId === folder.id && w.id === activeWallet?.id);
            return (
              <div key={folder.id}>
                {editingFolderId === folder.id ? (
                  <div className="flex gap-1 p-1">
                    <Input
                      value={editFolderName}
                      onChange={(e) => setEditFolderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRenameFolder(folder); if (e.key === "Escape") setEditingFolderId(null); }}
                      className="h-7 text-xs"
                      autoFocus
                    />
                    <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => handleRenameFolder(folder)}>Save</Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors group ${
                      isSelected ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    {isSelected
                      ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                      : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    }
                    <span className="flex-1 truncate">{folder.name}</span>
                    {hasActive && <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />}
                    <span className="text-xs text-muted-foreground shrink-0">{count}</span>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditFolderName(folder.name); setEditingFolderId(folder.id); }}
                        className="rounded p-0.5 hover:bg-muted"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); if (selectedFolder?.id === folder.id) setSelectedFolderId(null); }}
                        className="rounded p-0.5 hover:bg-muted text-destructive/70 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </button>
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
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddingWallet(true)}>
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
                <AddWalletForm folderId={selectedFolder.id} onDone={() => setAddingWallet(false)} />
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
```

**Step 2: Create or overwrite `app/(tools)/wallet-manager/page.tsx`:**

```tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { WalletManagerPanel } from "@/components/wallet-manager/WalletManagerPanel";

export default function WalletManagerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet Manager</h1>
        <p className="text-muted-foreground mt-2">
          Save and organise your Stellar wallets into folders. Connect a wallet
          to use it automatically in Bulk Payments, Ghost Payments, and other signing modules.
        </p>
      </div>
      <Suspense fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}>
        <WalletManagerPanel />
      </Suspense>
    </div>
  );
}
```

**Step 3: Compile check:**
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

---

### Task 5: Header wallet switcher dropdown

**Files:**
- Modify: `components/layout/header.tsx`

**Context:**
Current header (`components/layout/header.tsx`) has only the network selector. Add a wallet switcher to the left of the network selector. It shows the active wallet name + short address, or "No wallet" if none. On click, a dropdown lists all wallets grouped by folder. Clicking a wallet connects it. A "Manage Wallets →" link at the bottom opens `/wallet-manager`.

**Step 1: Replace `components/layout/header.tsx`:**

```tsx
"use client";

import Link from "next/link";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSettings, NETWORK_LABELS, type Network } from "@/lib/settings";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { Wallet, ChevronDown, CheckCircle2, LogOut } from "lucide-react";

const VISIBLE_NETWORKS: Network[] = ["public", "testnet"];
const NETWORK_COLORS: Record<Network, string> = {
  public: "bg-green-500",
  testnet: "bg-yellow-500",
  futurenet: "bg-purple-500",
  local: "bg-blue-500",
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function WalletSwitcher() {
  const { activeWallet, connect, disconnect } = useActiveWallet();
  const { folders } = useWalletFolders();
  const { wallets } = useWalletsV2();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 max-w-[200px]">
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          {activeWallet ? (
            <span className="truncate">{activeWallet.name}</span>
          ) : (
            <span className="text-muted-foreground">No wallet</span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {activeWallet && (
          <>
            <div className="px-2 py-1.5">
              <p className="text-xs font-semibold text-green-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {shortAddr(activeWallet.publicKey)}
              </p>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {folders.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No wallets saved. Go to Wallet Manager to add one.
          </div>
        ) : (
          folders.map((folder) => {
            const folderWallets = wallets.filter((w) => w.folderId === folder.id);
            if (folderWallets.length === 0) return null;
            return (
              <div key={folder.id}>
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal py-1">
                  {folder.name}
                </DropdownMenuLabel>
                {folderWallets.map((w) => (
                  <DropdownMenuItem
                    key={w.id}
                    onClick={() => connect(w.id)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{w.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{shortAddr(w.publicKey)}</p>
                    </div>
                    {activeWallet?.id === w.id && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </div>
            );
          })
        )}

        <DropdownMenuSeparator />
        {activeWallet && (
          <DropdownMenuItem onClick={disconnect} className="text-xs text-muted-foreground cursor-pointer">
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Disconnect
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/wallet-manager" className="text-xs cursor-pointer">
            Manage Wallets →
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header() {
  const { settings, updateSettings } = useSettings();

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-end border-b border-border bg-background/80 backdrop-blur px-4 md:px-8">
      <div className="flex items-center gap-2">
        <WalletSwitcher />
        <span className={`h-2 w-2 rounded-full shrink-0 ${NETWORK_COLORS[settings.network]}`} />
        <Select
          value={settings.network}
          onValueChange={(v) => updateSettings({ network: v as Network })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {VISIBLE_NETWORKS.map((n) => (
              <SelectItem key={n} value={n} className="text-xs">
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${NETWORK_COLORS[n]}`} />
                  {NETWORK_LABELS[n]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
```

**Step 2: Check that `DropdownMenu` components exist in the project:**
```bash
ls "C:/Users/Windows/Downloads/stellar-toolkit-dash/components/ui/" | grep -i dropdown
```
If the file doesn't exist, install the shadcn component:
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx shadcn@latest add dropdown-menu
```

**Step 3: Compile check:**
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

---

### Task 6: Replace secret key fields in Bulk Payments and Ghost Payments

**Files:**
- Modify: `components/bulk-payments/BulkPaymentsPanel.tsx`
- Modify: `components/ghost-payments/GhostPaymentsPanel.tsx`

**Context:**
Both panels currently have a `secretKey` state and a secret key `<Input>` field. Replace them with `useActiveWallet()`. If no wallet is connected, show a warning banner instead of the input.

**For each panel, the changes are identical:**

**Step 1: Add import at top of file:**
```ts
import { useActiveWallet } from "@/hooks/use-active-wallet";
```

**Step 2: Remove `secretKey` state and `showSecret` state:**
```ts
// REMOVE:
const [secretKey, setSecretKey] = useState("");
const [showSecret, setShowSecret] = useState(false);
```

**Step 3: Add active wallet hook call near the other hooks:**
```ts
const { activeWallet } = useActiveWallet();
const secretKey = activeWallet?.secretKey ?? "";
```

**Step 4: Remove the entire "Signing Secret Key" input field block** (the `<div className="space-y-2">` containing Label "Signing Secret Key" and the password Input + eye toggle button). Replace with a wallet status display:

```tsx
{/* Active wallet display */}
{activeWallet ? (
  <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 flex items-center gap-2 text-sm">
    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    <div>
      <p className="text-xs font-medium">{activeWallet.name}</p>
      <p className="text-xs text-muted-foreground font-mono">
        {activeWallet.publicKey.slice(0, 4)}…{activeWallet.publicKey.slice(-4)}
      </p>
    </div>
  </div>
) : (
  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 flex items-center gap-2 text-sm text-destructive">
    <AlertTriangle className="h-4 w-4 shrink-0" />
    <span>
      No wallet connected.{" "}
      <a href="/wallet-manager" className="underline hover:no-underline">
        Connect one →
      </a>
    </span>
  </div>
)}
```

**Step 5: Import `CheckCircle2` if not already imported.** Both panels already import `AlertTriangle`. Add `CheckCircle2` to the lucide-react import if missing.

**Step 6: Update `validateForm()` in each panel** — replace the secret key validation:
```ts
// REMOVE:
if (!secretKey.trim()) return "Signing secret key is required.";
if (!secretKey.trim().startsWith("S") || secretKey.trim().length !== 56)
  return "Secret key must start with S and be 56 characters.";

// REPLACE WITH:
if (!activeWallet) return "Connect a wallet first.";
```

**Step 7: Update `getSenderPublicKey()` in GhostPaymentsPanel** — replace derivation with direct property:
```ts
function getSenderPublicKey(): string | null {
  return activeWallet?.publicKey ?? null;
}
```

**Step 8: In GhostPaymentsPanel, update the `useEffect` that auto-fills the ghost asset** — it currently calls `Keypair.fromSecret(secretKey.trim()).publicKey()`. Replace with:
```ts
useEffect(() => {
  if (ghostMode !== "no_trust") return;
  if (!activeWallet) return;
  setAssetType("custom");
  setCustomAssetCode("GHOST");
  setCustomAssetIssuer(activeWallet.publicKey);
}, [activeWallet, ghostMode]);

// Second useEffect (mode switch):
useEffect(() => {
  if (ghostMode === "underfunded") {
    setAssetType("xlm");
    setUnderfundedAmount(null);
  } else {
    if (activeWallet) {
      setCustomAssetCode("GHOST");
      setCustomAssetIssuer(activeWallet.publicKey);
      setAssetType("custom");
    }
  }
}, [ghostMode, activeWallet]);
```

**Step 9: Remove the grid column config that was sized for the secret key input.** In BulkPaymentsPanel, the grid was `sm:grid-cols-[1fr_auto_auto_auto]` to fit secret key + batch size + fee mult. Now it's just batch size + fee mult:
```tsx
<div className="grid gap-4 sm:grid-cols-[auto_auto]">
```

**Step 10: Compile check:**
```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```
Expected: no errors in the modified panels.

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Module Inventory table:**
```markdown
| `wallet-manager` | Working — folders + named wallets, active wallet in header dropdown |
```

**Step 2: Add a new section:**
```markdown
## Wallet Manager
- Route: `app/(tools)/wallet-manager/page.tsx`
- Panel: `components/wallet-manager/WalletManagerPanel.tsx`
- **DB tables**: `wallet_folders` (id, name, position), `wallets` (id, folder_id FK, name, public_key, secret_key, position), `app_state` (key, value)
- **Hooks**: `hooks/use-wallet-folders.ts`, `hooks/use-wallets-v2.ts`, `hooks/use-active-wallet.ts`
- **Active wallet**: stored in `localStorage` as `active_wallet_id` for instant reads; also persisted to `app_state` DB table via `/api/db/app-state` POST for durability on localStorage wipe
- **Header switcher**: `WalletSwitcher` component inside `components/layout/header.tsx` — grouped by folder, shows connected state
- **Integration**: Bulk Payments and Ghost Payments read `activeWallet.secretKey` from `useActiveWallet()` — no manual secret key input
- `hooks/use-wallets.ts` is now a re-export stub pointing to `use-wallets-v2`
```
