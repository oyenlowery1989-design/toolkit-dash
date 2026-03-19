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
  FileCode2,
  ShieldCheck,
  Users,
  Link2,
  SendHorizonal,
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

export interface MenuSection {
  section: string;
}

export type MenuEntry = MenuItem | MenuSeparator | MenuSection;

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry && entry.separator === true;
}

export function isSection(entry: MenuEntry): entry is MenuSection {
  return "section" in entry;
}

export const menuItems: MenuEntry[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },

  { section: "Analysis" },
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
    title: "Bulk Asset Sales",
    href: "/bulk-asset-sales",
    icon: TrendingDown,
  },
  {
    title: "Account Investigator",
    href: "/address-investigator",
    icon: UserSearch,
  },
  {
    title: "Intermediary Tracer",
    href: "/intermediary-tracer",
    icon: GitFork,
  },
  {
    title: "Transaction Explorer",
    href: "/transactions",
    icon: ArrowDownUp,
  },

  { section: "Payments" },
  {
    title: "Single Payment",
    href: "/payments",
    icon: CreditCard,
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
    title: "Account Funder",
    href: "/account-funder",
    icon: Users,
  },
  {
    title: "Auto-Send Groups",
    href: "/auto-send-groups",
    icon: SendHorizonal,
  },
  {
    title: "Tiered Rewards",
    href: "/tiered-rewards",
    icon: Trophy,
  },

  { section: "Asset Lifecycle" },
  {
    title: "Asset Creator",
    href: "/asset-creator",
    icon: Wand2,
  },
  {
    title: "Token Control",
    href: "/asset-manager",
    icon: ShieldCheck,
  },
  {
    title: "Trustline Manager",
    href: "/trustline-manager",
    icon: Link2,
  },
  {
    title: "Soroban Contracts",
    href: "/soroban",
    icon: FileCode2,
  },

  { section: "DEX" },
  {
    title: "DEX Orderbook",
    href: "/dex-orderbook",
    icon: BarChart3,
  },

  { section: "My Data" },
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
    title: "Saved Analyses",
    href: "/saved-analyses",
    icon: BookmarkCheck,
  },
  {
    title: "Search History",
    href: "/search-history",
    icon: Clock,
  },

  { section: "Tools" },
  {
    title: "My Wallet",
    href: "/my-wallet",
    icon: Wallet,
  },
  {
    title: "Address Generator",
    href: "/address-generator",
    icon: Fingerprint,
  },
  {
    title: "Wallet Manager",
    href: "/wallet-manager",
    icon: Wallet,
  },

  { separator: true },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];
