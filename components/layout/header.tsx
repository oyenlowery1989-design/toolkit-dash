"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, NETWORK_LABELS, type Network } from "@/lib/settings";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { Wallet, ChevronDown, LogOut, RefreshCw } from "lucide-react";
import { shortAddr } from "@/lib/format";

const VISIBLE_NETWORKS: Network[] = ["public", "testnet"];

const NETWORK_COLORS: Record<Network, string> = {
  public: "bg-green-500",
  testnet: "bg-yellow-500",
  futurenet: "bg-purple-500",
  local: "bg-blue-500",
};

function WalletButton() {
  const { wallets } = useWalletsV2();
  const { activeWallet, connect, disconnect } = useActiveWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
          <div className="absolute right-0 top-10 z-50 w-64 rounded-md border border-border bg-popover shadow-lg">
            <div className="p-2 border-b border-border">
              <p className="text-xs text-muted-foreground px-1">Select a wallet to connect</p>
            </div>
            <div className="p-1 max-h-60 overflow-y-auto">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { connect(w.id); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted transition-colors"
                >
                  <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{w.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{shortAddr(w.publicKey)}</p>
                  </div>
                </button>
              ))}
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
        <span className="text-muted-foreground font-mono hidden sm:inline">
          {shortAddr(activeWallet.publicKey)}
        </span>
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
                <p className="text-xs text-muted-foreground font-mono">{activeWallet.publicKey}</p>
              </div>
            </div>
          </div>

          {/* Switch to another wallet */}
          {wallets.filter((w) => w.id !== activeWallet.id).length > 0 && (
            <div className="p-1 border-b border-border">
              <p className="text-xs text-muted-foreground px-2 py-1">Switch to</p>
              {wallets
                .filter((w) => w.id !== activeWallet.id)
                .map((w) => (
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

          {/* Actions */}
          <div className="p-1">
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

export function Header() {
  const { settings, updateSettings } = useSettings();

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-end border-b border-border bg-background/80 backdrop-blur px-4 md:px-8">
      <div className="flex items-center gap-3">
        <WalletButton />

        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${NETWORK_COLORS[settings.network]}`}
          />
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
      </div>
    </header>
  );
}
