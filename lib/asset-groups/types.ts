export type GroupMemberRole =
  | "issuer"
  | "distributor"
  | "creator"
  | "intermediary"
  | "bank"
  | "withdrawal"
  | "destination"
  | "service"
  | "other";

export const ROLE_LABELS: Record<GroupMemberRole, string> = {
  issuer:       "Issuer",
  distributor:  "Distributor",
  creator:      "Creator",
  intermediary: "Intermediary",
  bank:         "Bank / Consolidation",
  withdrawal:   "Withdrawal",
  destination:  "Destination",
  service:      "Service (CEX/DEX)",
  other:        "Other",
};

export const ROLE_COLORS: Record<GroupMemberRole, string> = {
  issuer:       "text-blue-400 bg-blue-400/10",
  distributor:  "text-purple-400 bg-purple-400/10",
  creator:      "text-green-400 bg-green-400/10",
  intermediary: "text-yellow-400 bg-yellow-400/10",
  bank:         "text-orange-400 bg-orange-400/10",
  withdrawal:   "text-red-400 bg-red-400/10",
  destination:  "text-red-500 bg-red-500/10",
  service:      "text-cyan-400 bg-cyan-400/10",
  other:        "text-gray-400 bg-gray-400/10",
};

export interface GroupMember {
  id: string;
  groupId: string;
  address: string;
  role: GroupMemberRole;
  label?: string;
  notes?: string;
  homeDomain?: string;
  addedAt: number;
}

export interface AssetGroup {
  id: string;
  name: string;
  assetCode?: string;
  issuer?: string;
  network: string;
  notes?: string;
  domain?: string;
  telegramChannel?: string;
  telegramLink?: string;
  personName?: string;
  personRole?: string;
  createdAt: number;
  updatedAt: number;
  members: GroupMember[];
}
