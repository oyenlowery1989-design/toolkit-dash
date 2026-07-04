"use client";

import { useRef, useState } from "react";
import { Wallet, ChevronDown, ChevronRight, X } from "lucide-react";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface WalletEntry {
  id: string;
  name: string;
  secretKey: string;
  publicKey: string;
}

// ---------------------------------------------------------------------------
// Shared folder-grouped wallet list (used by both pickers)
// ---------------------------------------------------------------------------

function FolderList({
  wallets,
  onPick,
  close,
}: {
  wallets: ReturnType<typeof useWalletsV2>["wallets"];
  onPick: (w: (typeof wallets)[number]) => void;
  close: () => void;
}) {
  const { folders } = useWalletFolders();
  // "expanded" tracks which folders are open — empty = all collapsed by default
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const folderIds = new Set(folders.map((f) => f.id));
  const orphaned = wallets.filter((w) => !folderIds.has(w.folderId));

  return (
    <>
      {folders.map((folder) => {
        const fw = wallets.filter((w) => w.folderId === folder.id);
        if (fw.length === 0) return null;
        const isCollapsed = !expanded.has(folder.id);
        return (
          <div key={folder.id}>
            <button
              onClick={() => toggle(folder.id)}
              className="w-full flex items-center gap-1.5 px-3 pt-2 pb-1 hover:text-foreground transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                : <ChevronDown className="h-3 w-3 text-muted-foreground/60" />}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {folder.name}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/40">{fw.length}</span>
            </button>
            {!isCollapsed && (
              <div className="px-1 pb-1">
                {fw.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => { onPick(w); close(); }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors"
                  >
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-sm truncate">{w.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground shrink-0">{shortAddr(w.publicKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {orphaned.length > 0 && (() => {
        const isCollapsed = !expanded.has("__other__");
        return (
          <div>
            <button
              onClick={() => toggle("__other__")}
              className="w-full flex items-center gap-1.5 px-3 pt-2 pb-1 hover:text-foreground transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                : <ChevronDown className="h-3 w-3 text-muted-foreground/60" />}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Other</span>
              <span className="ml-auto text-[10px] text-muted-foreground/40">{orphaned.length}</span>
            </button>
            {!isCollapsed && (
              <div className="px-1 pb-1">
                {orphaned.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => { onPick(w); close(); }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors"
                  >
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-sm truncate">{w.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground shrink-0">{shortAddr(w.publicKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}

// ---------------------------------------------------------------------------
// WalletSelect — set a keypair field from a saved wallet
// ---------------------------------------------------------------------------

interface WalletSelectProps {
  onPick: (wallet: WalletEntry) => void;
  onClear?: () => void;
  currentValue?: string;
  currentId?: string;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
}

export function WalletSelect({
  onPick,
  onClear,
  currentValue,
  currentId,
  triggerClassName,
  align = "end",
}: WalletSelectProps) {
  const { wallets } = useWalletsV2();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (!wallets.length) return null;

  const picked = currentId
    ? wallets.find((w) => w.id === currentId)
    : currentValue
    ? wallets.find((w) => w.secretKey === currentValue || w.publicKey === currentValue)
    : undefined;

  return (
    <div className="relative flex items-center gap-0.5" ref={ref} onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 h-6 text-xs px-2 rounded border-0 shadow-none hover:bg-accent transition-colors",
          triggerClassName
        )}
      >
        <Wallet className="h-3 w-3" />
        <span>{picked ? picked.name : "Use wallet"}</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>
      {picked && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center justify-center h-5 w-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Clear wallet"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-lg max-h-72 overflow-y-auto",
            align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2",
            "top-full"
          )}
        >
          <FolderList wallets={wallets} onPick={onPick} close={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WalletAppendSelect — append a secret key to a list
// ---------------------------------------------------------------------------

export function WalletAppendSelect({
  onAppend,
  align = "start",
}: {
  onAppend: (secretKey: string) => void;
  align?: "start" | "center" | "end";
}) {
  const { wallets } = useWalletsV2();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (!wallets.length) return null;

  return (
    <div className="relative" ref={ref} onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 h-7 text-xs px-2 rounded border border-input hover:bg-accent transition-colors"
      >
        <Wallet className="h-3 w-3" />
        <span>Add wallet key</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-lg max-h-72 overflow-y-auto",
            align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2"
          )}
        >
          <FolderList
            wallets={wallets}
            onPick={(w) => onAppend(w.secretKey)}
            close={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
