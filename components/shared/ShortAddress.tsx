"use client";
/* eslint-disable react-hooks/refs -- false positives: this rule flags any
   .map() in a component that also has a ref-touching closure assigned into
   data (handleShowBalance/handleCopy write to balanceAbortRef.current, but
   only inside their own click-handler bodies, never during render). */

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Check,
  ExternalLink,
  Plus,
  Search,
  Wallet,
  MoreVertical,
} from "lucide-react";
import { useAddressBook, ADDRESS_COLORS } from "@/hooks/use-address-book";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useKnownCreators } from "@/hooks/use-known-creators";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { usePersons } from "@/hooks/use-persons";
import { resolveAddress } from "@/lib/address-resolver";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { fetchXlmBalance, type XlmBalanceValue } from "@/lib/horizon-balance";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Role styles for explicit role prop (issuer / distrib passed from parent)
const ROLE_STYLES: Record<
  string,
  { dot: string; badge: string; badgeText: string; text: string }
> = {
  issuer: {
    dot: "bg-amber-400",
    badge: "bg-amber-400/15 border-amber-400/40 text-amber-400",
    badgeText: "ISSUER",
    text: "text-amber-400/90",
  },
  distrib: {
    dot: "bg-blue-400",
    badge: "bg-blue-400/15 border-blue-400/40 text-blue-400",
    badgeText: "DISTRIB",
    text: "text-blue-400/90",
  },
};

interface ShortAddressProps {
  address: string;
  label?: string;
  role?: "issuer" | "distrib";
  network?: "public" | "testnet" | string;
  suggestedLabel?: string;
  suggestedNotes?: string;
}

// Extra pixels of headroom required before expanding from the overflow menu
// back to inline icons, to avoid collapse/expand flicker right at the
// boundary width.
const EXPAND_SLACK_PX = 8;

// Approximate gap (px) between the address cluster and the icon cluster —
// matches the outer row's `gap-1.5` (0.375rem).
const CLUSTER_GAP_PX = 6;

function formatBalanceValue(value: XlmBalanceValue): string {
  if (value === "error") return "Error";
  if (value === "unfunded") return "Unfunded";
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} XLM`;
}

/**
 * Renders a Stellar address resolved from all known sources:
 *   1. Persons → PERSON badge (named human/entity owns this address)
 *   2. Known Intermediaries → INTERMEDIARY badge
 *   3. Known Creators → CREATOR badge
 *   4. Asset Group members → GROUP / role badge
 *   5. Address Book (user label)
 *   6. Raw truncated address
 */
export function ShortAddress({
  address,
  label,
  role,
  network = "public",
  suggestedLabel,
  suggestedNotes,
}: ShortAddressProps) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const { settings } = useSettings();

  const { entries: bookEntries } = useAddressBook();
  const { entries: intermediaries } = useKnownIntermediaries();
  const { entries: creators } = useKnownCreators();
  const { groups } = useAssetGroups();
  const { persons } = usePersons();

  // Collapsed (⋮ overflow menu) is the deterministic SSR/first-paint state;
  // useLayoutEffect expands to inline icons before paint if there's room.
  const [collapsed, setCollapsed] = useState(true);
  const rowRef = useRef<HTMLSpanElement>(null);
  const addressClusterRef = useRef<HTMLSpanElement>(null);
  // Always-mounted, invisible clone of the icon row — used purely to measure
  // its natural (unwrapped) width, since the real icon row only renders when
  // already expanded.
  const hiddenIconsProbeRef = useRef<HTMLSpanElement>(null);

  const [balance, setBalance] = useState<XlmBalanceValue | "loading" | null>(null);
  const balanceAbortRef = useRef<AbortController | null>(null);

  const resolved = resolveAddress(address, bookEntries, intermediaries, creators, groups, persons);

  // Address book entry for color
  const bookEntry = bookEntries.find((e) => e.publicKey === address);
  const bookColor = bookEntry?.color;
  const entryColorStyle = bookColor ? ADDRESS_COLORS[bookColor] : null;

  // Explicit role prop (issuer/distrib) only used when no higher-priority resolution
  const roleStyle = !entryColorStyle && !resolved.name && role ? ROLE_STYLES[role] : null;

  const displayText = resolved.name ?? `${address.slice(0, 4)}…${address.slice(-4)}`;

  const textClass = entryColorStyle
    ? `${entryColorStyle.text} hover:text-foreground`
    : roleStyle
      ? `${roleStyle.text} hover:text-foreground`
      : resolved.source !== "none"
        ? "text-foreground hover:text-foreground"
        : "text-muted-foreground hover:text-foreground";

  const dotClass = entryColorStyle?.dot ?? roleStyle?.dot ?? null;

  const explorerNetwork = network === "public" || network === "testnet" ? network : null;
  const explorerUrl = explorerNetwork
    ? `https://stellar.expert/explorer/${explorerNetwork}/account/${address}`
    : null;

  const showQuickAdd = resolved.source === "none" && !role;

  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleQuickAdd = () => {
    const params = new URLSearchParams({ add: address });
    if (suggestedLabel) params.set("label", suggestedLabel);
    if (suggestedNotes) params.set("notes", suggestedNotes);
    router.push(`/address-book?${params.toString()}`);
  };

  const handleInvestigate = () => {
    router.push(`/address-investigator?address=${address}`);
  };

  const handleShowBalance = () => {
    if (balance === "loading") return;
    setBalance("loading");
    balanceAbortRef.current?.abort();
    const controller = new AbortController();
    balanceAbortRef.current = controller;
    const horizonUrl = resolveHorizonUrl(settings);
    fetchXlmBalance(horizonUrl, address, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setBalance(value);
    });
  };

  useLayoutEffect(() => {
    return () => balanceAbortRef.current?.abort();
  }, []);

  const tooltip = resolved.name
    ? `${resolved.name} — ${address} (click to copy)`
    : `Click to copy: ${address}`;

  // Which badge to show — resolver badge takes priority over role badge
  const activeBadge = resolved.badge
    ? { text: resolved.badge, cls: resolved.badgeClass! }
    : roleStyle
      ? { text: roleStyle.badgeText, cls: roleStyle.badge }
      : null;

  type ActionDef = {
    id: string;
    icon: React.ReactNode;
    label: string;
    onSelect: () => void;
    href?: string;
  };

  const actions: ActionDef[] = [
    {
      id: "copy",
      icon: <Copy className="h-3 w-3" />,
      label: "Copy address",
      onSelect: handleCopy,
    },
    ...(explorerUrl
      ? [
          {
            id: "explorer",
            icon: <ExternalLink className="h-3 w-3" />,
            label: "Open in Stellar.Expert",
            onSelect: () => window.open(explorerUrl, "_blank", "noopener,noreferrer"),
            href: explorerUrl,
          },
        ]
      : []),
    ...(showQuickAdd
      ? [
          {
            id: "add-to-book",
            icon: <Plus className="h-3 w-3" />,
            label: "Add to Address Book",
            onSelect: handleQuickAdd,
          },
        ]
      : []),
    {
      id: "investigate",
      icon: <Search className="h-3 w-3" />,
      label: "Investigate",
      onSelect: handleInvestigate,
    },
    {
      id: "show-balance",
      icon: <Wallet className="h-3 w-3" />,
      label: "Show XLM Balance",
      onSelect: handleShowBalance,
    },
  ];

  // Adaptive collapse: compare the address cluster's rendered width plus the
  // icon row's natural (unwrapped) width — measured via an always-mounted,
  // invisible probe, since the real icon row only renders once expanded —
  // against the space actually available. Recomputed from scratch on every
  // resize, so there's no stored/stale "needed width" to get out of sync.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const addressEl = addressClusterRef.current;
    const probeEl = hiddenIconsProbeRef.current;
    if (!row || !addressEl || !probeEl) return;

    const measure = () => {
      const available = row.parentElement?.clientWidth ?? row.clientWidth;
      const needed =
        addressEl.getBoundingClientRect().width +
        probeEl.getBoundingClientRect().width +
        CLUSTER_GAP_PX;

      setCollapsed((prevCollapsed) => {
        const shouldExpand = available >= needed + (prevCollapsed ? EXPAND_SLACK_PX : 0);
        return !shouldExpand;
      });
    };

    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    if (row.parentElement) observer.observe(row.parentElement);
    observer.observe(row);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    // Re-measure when the action set itself changes shape (e.g. explorer
    // link or quick-add gating flips); the ResizeObserver above already
    // handles container-width changes without needing a re-run here.
  }, [actions.length]);

  return (
    <span
      ref={rowRef}
      className="relative inline-flex items-center gap-1.5 flex-wrap"
    >
      {dotClass && (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
      )}

      <span ref={addressClusterRef} className="inline-flex items-center gap-1.5">
        <button
          className={`inline-flex items-center gap-1 font-mono text-xs transition-colors group ${textClass}`}
          title={tooltip}
          onClick={handleCopy}
        >
          {label && (
            <span className="text-muted-foreground/60 not-mono text-[10px] uppercase mr-0.5">
              {label}
            </span>
          )}
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60" />
          )}
          {displayText}
        </button>

        {activeBadge && (
          <span
            className={`inline-flex items-center px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide leading-none ${activeBadge.cls}`}
          >
            {activeBadge.text}
          </span>
        )}

        {balance !== null && (
          <span className="text-[10px] font-mono text-muted-foreground/80">
            {balance === "loading" ? "…" : formatBalanceValue(balance)}
          </span>
        )}
      </span>

      {collapsed ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Actions"
          >
            <MoreVertical className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onSelect={(e) => {
                  if (action.id === "show-balance") e.preventDefault();
                  action.onSelect();
                }}
                className="gap-2 text-xs"
              >
                {action.icon}
                {action.id === "show-balance" && balance !== null
                  ? balance === "loading"
                    ? "Loading…"
                    : formatBalanceValue(balance)
                  : action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="inline-flex items-center gap-1">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={(e) => {
                e.stopPropagation();
                action.onSelect();
              }}
              title={action.label}
              className="text-muted-foreground/40 hover:text-primary transition-colors"
            >
              {action.icon}
            </button>
          ))}
        </span>
      )}

      {/* Invisible, always-mounted clone of the icon row — measures the
          natural (unwrapped) width used to decide inline-vs-menu above. */}
      <span
        ref={hiddenIconsProbeRef}
        aria-hidden
        className="invisible absolute whitespace-nowrap pointer-events-none inline-flex items-center gap-1"
      >
        {actions.map((action) => (
          <span key={action.id} className="inline-flex h-3 w-3">
            {action.icon}
          </span>
        ))}
      </span>
    </span>
  );
}
