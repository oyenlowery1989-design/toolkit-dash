"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X, Rocket, Sun, Moon, Database, UserSearch, GitFork, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useSettings, NETWORK_LABELS, type Network } from "@/lib/settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { menuItems, isSeparator, isSection } from "@/lib/navigation";
import { useSavedSearches } from "@/hooks/use-saved-searches";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const { settings, updateSettings } = useSettings();

  const VISIBLE_NETWORKS: Network[] = ["public", "testnet"];
  const NETWORK_DOTS: Record<Network, string> = {
    public: "bg-blue-500",
    testnet: "bg-yellow-500",
    futurenet: "bg-purple-500",
    local: "bg-gray-400",
  };
  const { theme, setTheme } = useTheme();
  const { history: savedSearches, remove: removeSearch } = useSavedSearches();

  const handleSearchClick = (type: string, value: string) => {
    setIsOpen(false);
    if (type === "address") {
      router.push(`/address-investigator?address=${encodeURIComponent(value)}`);
    } else if (type === "intermediary-scan") {
      router.push(`/intermediary-tracer?tab=scan&address=${encodeURIComponent(value)}`);
    } else if (type === "intermediary-trace") {
      router.push(`/intermediary-tracer?tab=trace&address=${encodeURIComponent(value)}`);
    } else {
      const [code, issuer] = value.split(":");
      router.push(`/asset-lookup?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`);
    }
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <div className="md:hidden fixed top-4 left-4 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsOpen(!isOpen)}
          className="bg-background border-border"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Sidebar Container */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static md:h-screen",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center px-6 border-b border-border">
            <Rocket className="h-6 w-6 text-primary mr-2" />
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
              Stellar Toolkit
            </span>
          </div>

          {/* Navigation + Recent */}
          <div className="flex-1 overflow-y-auto">
            <nav className="px-4 py-6 space-y-1">
              {menuItems.map((entry, index) => {
                if (isSeparator(entry)) {
                  return (
                    <div
                      key={`sep-${index}`}
                      className="my-2 border-t border-border"
                    />
                  );
                }
                if (isSection(entry)) {
                  return (
                    <div
                      key={`sec-${index}`}
                      className="pt-4 pb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
                    >
                      {entry.section}
                    </div>
                  );
                }
                const isActive = pathname === entry.href;
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      "flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors group",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <entry.icon
                      className={cn(
                        "mr-3 h-5 w-5 flex-shrink-0",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-accent-foreground",
                      )}
                    />
                    <span className="flex-1">{entry.title}</span>
                    {entry.badge && (
                      <span className="ml-auto bg-muted text-xs py-0.5 px-2 rounded-full">
                        {entry.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Recent Searches */}
            {savedSearches.length > 0 && (
              <div className="px-4 pb-4 border-t border-border pt-4">
                <button
                  className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
                  onClick={() => setRecentOpen((v) => !v)}
                >
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Recent Searches
                  </span>
                  {recentOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>

                {recentOpen && (
                  <div className="space-y-0.5">
                    {savedSearches.slice(0, 10).map((entry) => {
                      const isAddress = entry.type === "address";
                      const isIntermediary = entry.type === "intermediary-scan" || entry.type === "intermediary-trace";
                      const Icon = isAddress ? UserSearch : isIntermediary ? GitFork : Database;
                      const label = isAddress
                        ? `${entry.value.slice(0, 4)}…${entry.value.slice(-4)}`
                        : entry.value.split(":")[0];
                      const sub = isAddress
                        ? undefined
                        : `${entry.value.split(":")[1]?.slice(0, 6)}…`;

                      return (
                        <div
                          key={entry.timestamp}
                          className="flex items-center gap-1.5 group rounded-md hover:bg-accent px-2 py-1.5"
                        >
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <button
                            className="flex-1 min-w-0 text-left"
                            onClick={() => handleSearchClick(entry.type, entry.value)}
                          >
                            <span className="text-xs font-mono text-foreground truncate block">
                              {label}
                            </span>
                            {sub && (
                              <span className="text-[10px] font-mono text-muted-foreground truncate block">
                                {sub}
                              </span>
                            )}
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => removeSearch(entry.timestamp)}
                            aria-label="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border">
            <div className="bg-accent/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground">
                    Stellar Toolkit v1.0.0
                  </p>
                  <Select
                    value={settings.network}
                    onValueChange={(v) => updateSettings({ network: v as Network })}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs border-0 bg-transparent p-0 shadow-none focus:ring-0 gap-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${NETWORK_DOTS[settings.network]}`} />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent side="top">
                      {VISIBLE_NETWORKS.map((n) => (
                        <SelectItem key={n} value={n} className="text-xs">
                          <span className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${NETWORK_DOTS[n]}`} />
                            {NETWORK_LABELS[n]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() =>
                      setTheme(theme === "dark" ? "light" : "dark")
                    }
                    aria-label="Toggle theme"
                  >
                    <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  </Button>
                  <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    <span className="text-xs">Ctrl</span>K
                  </kbd>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
