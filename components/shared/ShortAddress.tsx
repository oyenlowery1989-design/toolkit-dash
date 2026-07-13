"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, ExternalLink, Plus } from "lucide-react";
import { useAddressBook, ADDRESS_COLORS } from "@/hooks/use-address-book";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useKnownCreators } from "@/hooks/use-known-creators";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { usePersons } from "@/hooks/use-persons";
import { resolveAddress } from "@/lib/address-resolver";

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
  const [hovered, setHovered] = useState(false);
  const router = useRouter();

  const { entries: bookEntries } = useAddressBook();
  const { entries: intermediaries } = useKnownIntermediaries();
  const { entries: creators } = useKnownCreators();
  const { groups } = useAssetGroups();
  const { persons } = usePersons();

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

  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    const params = new URLSearchParams({ add: address });
    if (suggestedLabel) params.set("label", suggestedLabel);
    if (suggestedNotes) params.set("notes", suggestedNotes);
    router.push(`/address-book?${params.toString()}`);
  };

  const tooltip = resolved.name
    ? `${resolved.name} — ${address} (click to copy)`
    : `Click to copy: ${address}`;

  // Which badge to show — resolver badge takes priority over role badge
  const activeBadge = resolved.badge
    ? { text: resolved.badge, cls: resolved.badgeClass! }
    : roleStyle
      ? { text: roleStyle.badgeText, cls: roleStyle.badge }
      : null;

  return (
    <span
      className="inline-flex items-center gap-1.5 flex-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {dotClass && (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
      )}

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

      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Stellar.Expert"
          className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {/* Quick-add to address book — only for completely unrecognised addresses */}
      {resolved.source === "none" && !role && hovered && (
        <button
          onClick={handleQuickAdd}
          title="Add to Address Book"
          className="text-muted-foreground/40 hover:text-primary transition-colors"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}

      {activeBadge && (
        <span
          className={`inline-flex items-center px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide leading-none ${activeBadge.cls}`}
        >
          {activeBadge.text}
        </span>
      )}
    </span>
  );
}
