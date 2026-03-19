import {
  LayoutDashboard,
  Fingerprint,
  Database,
  Wallet,
  CreditCard,
  Settings,
  BarChart3,
  Coins,
  UserSearch,
  Megaphone,
  TrendingDown,
  Clock,
  BookmarkCheck,
  BookUser,
  GitFork,
  Layers,
  Ghost,
  ArrowDownUp,
  Wand2,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export interface MenuItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry && entry.separator === true;
}

export const menuItems: MenuEntry[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  { separator: true },
  {
    title: "Address Generator",
    href: "/address-generator",
    icon: Fingerprint,
  },
  {
    title: "Asset Lookup",
    href: "/asset-lookup",
    icon: Database,
  },
  {
    title: "Asset Sales",
    href: "/asset-sales",
    icon: Coins,
  },
  {
    title: "Address Investigator",
    href: "/address-investigator",
    icon: UserSearch,
  },
  {
    title: "Bulk Payments",
    href: "/bulk-payments",
    icon: Megaphone,
  },
  {
    title: "Ghost Payments",
    href: "/ghost-payments",
    icon: Ghost,
  },
  {
    title: "Tiered Rewards",
    href: "/tiered-rewards",
    icon: Trophy,
  },
  {
    title: "Asset Creator",
    href: "/asset-creator",
    icon: Wand2,
  },
  {
    title: "Bulk Asset Sales",
    href: "/bulk-asset-sales",
    icon: TrendingDown,
  },
  { separator: true },
  {
    title: "Search History",
    href: "/search-history",
    icon: Clock,
  },
  {
    title: "Saved Analyses",
    href: "/saved-analyses",
    icon: BookmarkCheck,
  },
  {
    title: "Address Book",
    href: "/address-book",
    icon: BookUser,
  },
  {
    title: "Asset Groups",
    href: "/groups",
    icon: Layers,
  },
  {
    title: "Intermediary Tracer",
    href: "/intermediary-tracer",
    icon: GitFork,
  },
  { separator: true },
  {
    title: "Account Operations",
    href: "/transactions",
    icon: ArrowDownUp,
  },
  {
    title: "DEX Orderbook",
    href: "/dex-orderbook",
    icon: BarChart3,
  },
  {
    title: "Wallet Manager",
    href: "/wallet-manager",
    icon: Wallet,
  },
  {
    title: "Payments",
    href: "/payments",
    icon: CreditCard,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];
