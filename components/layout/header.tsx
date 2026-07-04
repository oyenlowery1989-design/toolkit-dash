"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSettings, resolveHorizonUrl, NETWORK_LABELS, type Network } from "@/lib/settings";
import { Horizon } from "stellar-sdk";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useWalletFolders } from "@/hooks/use-wallet-folders";
import { Wallet, ChevronDown, ChevronRight, LogOut, RefreshCw, Copy, Check, UserCircle, KeyRound, Eye } from "lucide-react";
import { shortAddr } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { isAuthEnabled } from "@/lib/supabase-client";


function WalletButton() {
  const { wallets } = useWalletsV2();
  const { folders } = useWalletFolders();
  const { activeWallet, connect, disconnect } = useActiveWallet();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  const horizonUrl = resolveHorizonUrl(settings);

  useEffect(() => {
    if (!activeWallet) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const server = new Horizon.Server(horizonUrl);
    server.loadAccount(activeWallet.publicKey)
      .then((acc: { balances: Array<{ asset_type: string; balance: string }> }) => {
        if (cancelled) return;
        const native = acc.balances.find((b: { asset_type: string }) => b.asset_type === "native");
        setBalance(native ? parseFloat(native.balance).toFixed(2) : "0.00");
      })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, [activeWallet, horizonUrl]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // No wallet connected — show login prompt
  if (!activeWallet) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => wallets.length > 0 ? setOpen((v) => !v) : undefined}
          className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 h-8 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Wallet className="h-3.5 w-3.5" />
          {wallets.length === 0 ? (
            <Link href="/wallet-manager" className="hover:underline">
              Connect Wallet
            </Link>
          ) : (
            <>
              <span>Connect Wallet</span>
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>

        {open && wallets.length > 0 && (
          <div className="absolute right-0 top-12 z-50 w-68 rounded-md border border-border bg-popover shadow-lg" style={{ width: "17rem" }}>
            <div className="p-2 border-b border-border">
              <p className="text-xs text-muted-foreground px-1">Select a wallet to connect</p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {folders.map((folder) => {
                const folderWallets = wallets.filter((w) => w.folderId === folder.id);
                if (folderWallets.length === 0) return null;
                const isCollapsed = !expandedFolders.has(folder.id);
                return (
                  <div key={folder.id}>
                    <button
                      onClick={() => toggleFolder(folder.id)}
                      className="w-full flex items-center gap-1.5 px-3 pt-2 pb-1 hover:text-foreground transition-colors"
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                        : <ChevronDown className="h-3 w-3 text-muted-foreground/60" />}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                        {folder.name}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground/40">{folderWallets.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="px-1 pb-1">
                        {folderWallets.map((w) => (
                          <button
                            key={w.id}
                            onClick={() => { connect(w.id); setOpen(false); }}
                            className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors"
                          >
                            {w.secretKey
                              ? <span title="Full wallet"><KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></span>
                              : <span title="Watch only"><Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></span>}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{w.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{shortAddr(w.publicKey)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Wallets with no matching folder */}
              {(() => {
                const folderIds = new Set(folders.map((f) => f.id));
                const orphaned = wallets.filter((w) => !folderIds.has(w.folderId));
                if (orphaned.length === 0) return null;
                const isCollapsed = !expandedFolders.has("__other__");
                return (
                  <div>
                    <button
                      onClick={() => toggleFolder("__other__")}
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
                          onClick={() => { connect(w.id); setOpen(false); }}
                          className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors"
                        >
                          <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{w.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{shortAddr(w.publicKey)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="p-1 border-t border-border">
              <Link
                href="/wallet-manager"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setOpen(false)}
              >
                Manage wallets →
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Wallet connected — show account pill with dropdown
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/8 px-3 h-8 text-xs hover:bg-green-500/15 transition-colors"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
        <span className="font-medium max-w-[100px] truncate">{activeWallet.name}</span>
        {!activeWallet.secretKey && (
          <span className="flex items-center gap-1 text-amber-400 hidden sm:inline-flex">
            <Eye className="h-3 w-3" />
            <span className="text-[10px]">watch</span>
          </span>
        )}
        <span className="text-muted-foreground font-mono hidden sm:inline">
          {shortAddr(activeWallet.publicKey)}
        </span>
        {balance !== null && (
          <span className="text-green-600 dark:text-green-400 font-mono hidden sm:inline">
            {balance} XLM
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-md border border-border bg-popover shadow-lg">
          {/* Current wallet info */}
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{activeWallet.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{shortAddr(activeWallet.publicKey)}</p>
              </div>
            </div>
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(activeWallet.publicKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
              >
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied!" : "Copy address"}
              </button>
            </div>
          </div>

          {/* Switch to another wallet — grouped by folder */}
          {wallets.filter((w) => w.id !== activeWallet.id).length > 0 && (
            <div className="border-b border-border max-h-56 overflow-y-auto">
              <p className="text-xs text-muted-foreground px-3 pt-2 pb-1">Switch to</p>
              {folders.map((folder) => {
                const fw = wallets.filter((w) => w.id !== activeWallet.id && w.folderId === folder.id);
                if (fw.length === 0) return null;
                const isCollapsed = !expandedFolders.has(`switch-${folder.id}`);
                return (
                  <div key={folder.id}>
                    <button
                      onClick={() => toggleFolder(`switch-${folder.id}`)}
                      className="w-full flex items-center gap-1.5 px-3 pt-1 pb-1 hover:text-foreground transition-colors"
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                        : <ChevronDown className="h-3 w-3 text-muted-foreground/60" />}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{folder.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/40">{fw.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="px-1 pb-1">
                        {fw.map((w) => (
                          <button
                            key={w.id}
                            onClick={() => { connect(w.id); setOpen(false); }}
                            className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{w.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{shortAddr(w.publicKey)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Orphaned wallets */}
              {(() => {
                const folderIds = new Set(folders.map((f) => f.id));
                const orphaned = wallets.filter((w) => w.id !== activeWallet.id && !folderIds.has(w.folderId));
                if (orphaned.length === 0) return null;
                const isCollapsed = !expandedFolders.has("switch-__other__");
                return (
                  <div>
                    <button
                      onClick={() => toggleFolder("switch-__other__")}
                      className="w-full flex items-center gap-1.5 px-3 pt-1 pb-1 hover:text-foreground transition-colors"
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
                            onClick={() => { connect(w.id); setOpen(false); }}
                            className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{w.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{shortAddr(w.publicKey)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Actions */}
          <div className="p-1">
            <Link
              href="/address-book"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setOpen(false)}
            >
              + Save to Address Book
            </Link>
            <Link
              href="/wallet-manager"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setOpen(false)}
            >
              Manage wallets →
            </Link>
            <button
              onClick={() => { disconnect(); setOpen(false); }}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive/70 hover:text-destructive hover:bg-muted transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthButton() {
  const { session, signOut } = useAuth();
  if (!isAuthEnabled()) return null;
  return (
    <button
      onClick={signOut}
      title={session?.user?.email ?? "Sign out"}
      className="flex items-center gap-1.5 rounded-md border border-border px-2 h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      <UserCircle className="h-3.5 w-3.5" />
      <span className="hidden sm:inline max-w-[120px] truncate">
        {session?.user?.email ?? "Account"}
      </span>
      <LogOut className="h-3 w-3 opacity-60" />
    </button>
  );
}

const NETWORK_STYLES: Record<Network, { dot: string; badge: string }> = {
  public:    { dot: "bg-blue-500",   badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  testnet:   { dot: "bg-yellow-500", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  futurenet: { dot: "bg-purple-500", badge: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  local:     { dot: "bg-gray-400",   badge: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
};

export function Header() {
  const { settings } = useSettings();
  const net = settings.network;
  const style = NETWORK_STYLES[net];

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/80 backdrop-blur px-4 md:px-8">
      {/* Network badge */}
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${style.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {NETWORK_LABELS[net]}
      </span>

      {/* Right — wallet + auth */}
      <div className="flex items-center gap-2">
        <WalletButton />
        <AuthButton />
      </div>
    </header>
  );
}
