"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Layers,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Globe,
  ExternalLink,
  UserPlus,
  KeyRound,
  Zap,
  Wallet,
  Loader2,
  Send,
  UserX,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAssetGroups, waitForGroupId } from "@/hooks/use-asset-groups";
import { usePersons, waitForPersonId } from "@/hooks/use-persons";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import type { WalletEntry } from "@/hooks/use-wallets-v2";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { AlertTriangle, Info } from "lucide-react";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import type { Network } from "@/lib/settings";
import { fetchHomeDomain } from "@/components/shared/ChainDisplay";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/asset-groups/types";
import { normalizeExternalUrl, resolveTelegramUrl } from "@/lib/asset-groups/links";
import type {
  AssetGroup,
  GroupMember,
  GroupMemberRole,
} from "@/lib/asset-groups/types";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { shortAddr } from "@/lib/format";

const ALL_ROLES = Object.keys(ROLE_LABELS) as GroupMemberRole[];

// ---------------------------------------------------------------------------
// Add Member Form
// ---------------------------------------------------------------------------
function AddMemberForm({
  groupId,
  onAdd,
  onCancel,
  prefill,
}: {
  groupId: string;
  onAdd: (
    groupId: string,
    m: Omit<GroupMember, "id" | "groupId" | "addedAt">,
  ) => void;
  onCancel: () => void;
  prefill?: {
    address?: string;
    role?: GroupMemberRole;
    label?: string;
    homeDomain?: string;
  };
}) {
  const [address, setAddress] = useState(prefill?.address ?? "");
  const [role, setRole] = useState<GroupMemberRole>(prefill?.role ?? "other");
  const [label, setLabel] = useState(prefill?.label ?? "");
  const [notes, setNotes] = useState("");
  const [homeDomain, setHomeDomain] = useState(prefill?.homeDomain ?? "");
  const { groups } = useAssetGroups();

  const trimmed = address.trim();
  const sameGroupDuplicate = trimmed
    ? groups.find((g) => g.id === groupId)?.members.find((m) => m.address === trimmed)
    : undefined;
  const otherGroupMatches = trimmed
    ? groups.filter((g) => g.id !== groupId && g.members.some((m) => m.address === trimmed))
    : [];

  function handleSubmit() {
    if (!trimmed || sameGroupDuplicate) return;
    onAdd(groupId, {
      address: trimmed,
      role,
      label: label.trim() || undefined,
      notes: notes.trim() || undefined,
      homeDomain: homeDomain.trim() || undefined,
    });
    onCancel();
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Add Address
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Address *</Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G…"
            className="font-mono text-xs"
          />
          {sameGroupDuplicate && (
            <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Already in this group as <strong>{ROLE_LABELS[sameGroupDuplicate.role]}</strong>{sameGroupDuplicate.label ? ` (${sameGroupDuplicate.label})` : ""}. Remove it first to re-add.</span>
            </div>
          )}
          {otherGroupMatches.length > 0 && (
            <div className="flex items-start gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs text-blue-600 dark:text-blue-400">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Also in: {otherGroupMatches.map((g, i) => {
                  const m = g.members.find((m) => m.address === trimmed)!;
                  return (
                    <span key={g.id}>
                      {i > 0 && ", "}
                      <strong>{g.name}</strong> as {ROLE_LABELS[m.role]}{m.label ? ` (${m.label})` : ""}
                    </span>
                  );
                })}
              </span>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Role</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as GroupMemberRole)}
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES.map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Binance"
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Home Domain</Label>
          <Input
            value={homeDomain}
            onChange={(e) => setHomeDomain(e.target.value)}
            placeholder="example.com"
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            className="text-xs"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!address.trim() || !!sameGroupDuplicate}>
          <Check className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Detail Card
// ---------------------------------------------------------------------------
function GroupCard({
  group,
  defaultOpen,
}: {
  group: AssetGroup;
  defaultOpen?: boolean;
}) {
  const {
    groups,
    updateGroup,
    unlinkGroupPerson,
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
  } = useAssetGroups();
  const { persons, createPerson } = usePersons();
  const { settings } = useSettings();
  // ShortAddress accepts any network string and guards explorer links itself —
  // don't narrow to public/testnet or futurenet/local get mislabeled.
  const network = settings.network;
  const { wallets } = useWalletsV2();
  const { activeWallet, connect } = useActiveWallet();
  const router = useRouter();

  const walletMap = useMemo(() => {
    const m = new Map<string, WalletEntry>();
    for (const w of wallets) m.set(w.publicKey, w);
    return m;
  }, [wallets]);

  const [open, setOpen] = useState(defaultOpen ?? false);
  // Deep link (?open=ID) can arrive via client-side nav while card is already
  // mounted — useState initializer alone would miss it.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(group.notes ?? "");
  const [editingDomain, setEditingDomain] = useState(false);
  const [domainVal, setDomainVal] = useState(group.domain ?? "");
  const [editingTelegramChannel, setEditingTelegramChannel] = useState(false);
  const [telegramChannelVal, setTelegramChannelVal] = useState(group.telegramChannel ?? "");
  const [editingTelegramLink, setEditingTelegramLink] = useState(false);
  const [telegramLinkVal, setTelegramLinkVal] = useState(group.telegramLink ?? "");
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [newPersonMode, setNewPersonMode] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonRole, setNewPersonRole] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  // State for inline member editing
  const [memberEdit, setMemberEdit] = useState<{
    label: string;
    notes: string;
    role: GroupMemberRole;
    homeDomain: string;
  }>({ label: "", notes: "", role: "other", homeDomain: "" });

  function startEditMember(m: GroupMember) {
    setEditingMemberId(m.id);
    setMemberEdit({
      label: m.label ?? "",
      notes: m.notes ?? "",
      role: m.role,
      homeDomain: m.homeDomain ?? "",
    });
  }

  function saveMember(m: GroupMember) {
    updateMember(group.id, m.id, {
      label: memberEdit.label.trim() || undefined,
      notes: memberEdit.notes.trim() || undefined,
      role: memberEdit.role,
      homeDomain: memberEdit.homeDomain.trim() || undefined,
    });
    setEditingMemberId(null);
  }

  function saveGroupName() {
    const trimmed = nameVal.trim();
    if (!trimmed) {
      setNameVal(group.name);
      setEditingName(false);
      return;
    }

    const duplicate = groups.some(
      (g) =>
        g.id !== group.id && g.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      setRenameError("Name already used by another group.");
      return;
    }

    updateGroup(group.id, { name: trimmed });
    setRenameError(null);
    setEditingName(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div>
                <div className="flex items-center gap-2">
                  <Input
                    value={nameVal}
                    onChange={(e) => {
                      setNameVal(e.target.value);
                      setRenameError(null);
                    }}
                    className="h-7 text-sm font-semibold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        saveGroupName();
                      }
                      if (e.key === "Escape") {
                        setNameVal(group.name);
                        setRenameError(null);
                        setEditingName(false);
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={saveGroupName}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                </div>
                {renameError && (
                  <p className="text-xs text-destructive">{renameError}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setEditingName(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {group.domain && (
                  <a
                    href={normalizeExternalUrl(group.domain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={group.domain}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </a>
                )}
                {resolveTelegramUrl(group.telegramChannel, group.telegramLink) && (
                  <a
                    href={resolveTelegramUrl(group.telegramChannel, group.telegramLink)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={group.telegramChannel || "Telegram"}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {group.telegramChannel && <span>@{group.telegramChannel.replace(/^[@/]+/, "")}</span>}
                  </a>
                )}
              </div>
            )}
            {group.assetCode && (
              <CardDescription className="mt-0.5">
                {group.assetCode}
                {group.issuer && (
                  <span className="font-mono ml-1 text-xs">
                    {shortAddr(group.issuer)}
                  </span>
                )}
                <span className="ml-2 text-xs">{group.network}</span>
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">
              {group.members.length} addresses
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete group "${group.name}" and its ${group.members.length} addresses? This cannot be undone.`,
                  )
                ) {
                  deleteGroup(group.id);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Investigation Notes
            </Label>
            {editingNotes ? (
              <div className="flex gap-2">
                <Input
                  value={notesVal}
                  onChange={(e) => setNotesVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { notes: notesVal });
                      setEditingNotes(false);
                    }
                    if (e.key === "Escape") {
                      setNotesVal(group.notes ?? "");
                      setEditingNotes(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { notes: notesVal });
                    setEditingNotes(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingNotes(true)}
              >
                {group.notes || (
                  <span className="italic">Add investigation notes…</span>
                )}
              </Button>
            )}
          </div>

          {/* Website */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Website</Label>
            {editingDomain ? (
              <div className="flex gap-2">
                <Input
                  value={domainVal}
                  onChange={(e) => setDomainVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="example.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { domain: domainVal });
                      setEditingDomain(false);
                    }
                    if (e.key === "Escape") {
                      setDomainVal(group.domain ?? "");
                      setEditingDomain(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { domain: domainVal });
                    setEditingDomain(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingDomain(true)}
              >
                {group.domain || <span className="italic">Add website…</span>}
              </Button>
            )}
          </div>

          {/* Telegram Channel */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Telegram Channel</Label>
            {editingTelegramChannel ? (
              <div className="flex gap-2">
                <Input
                  value={telegramChannelVal}
                  onChange={(e) => setTelegramChannelVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="channelname"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { telegramChannel: telegramChannelVal });
                      setEditingTelegramChannel(false);
                    }
                    if (e.key === "Escape") {
                      setTelegramChannelVal(group.telegramChannel ?? "");
                      setEditingTelegramChannel(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { telegramChannel: telegramChannelVal });
                    setEditingTelegramChannel(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingTelegramChannel(true)}
              >
                {group.telegramChannel || <span className="italic">Add Telegram channel…</span>}
              </Button>
            )}
          </div>

          {/* Telegram Link */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Telegram Link</Label>
            {editingTelegramLink ? (
              <div className="flex gap-2">
                <Input
                  value={telegramLinkVal}
                  onChange={(e) => setTelegramLinkVal(e.target.value)}
                  className="text-xs"
                  autoFocus
                  placeholder="t.me/channelname"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateGroup(group.id, { telegramLink: telegramLinkVal });
                      setEditingTelegramLink(false);
                    }
                    if (e.key === "Escape") {
                      setTelegramLinkVal(group.telegramLink ?? "");
                      setEditingTelegramLink(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateGroup(group.id, { telegramLink: telegramLinkVal });
                    setEditingTelegramLink(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingTelegramLink(true)}
              >
                {group.telegramLink || <span className="italic">Add Telegram link…</span>}
              </Button>
            )}
          </div>

          {/* Attributed Person */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Attributed Person</Label>
            {group.personId ? (
              (() => {
                const person = persons.find((p) => p.id === group.personId);
                return (
                  <div className="flex items-center gap-2 text-xs">
                    <Link href={`/persons?open=${group.personId}`} className="hover:underline">
                      {person ? [person.name, person.role].filter(Boolean).join(" — ") : "Unknown person"}
                    </Link>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => unlinkGroupPerson(group.id)}>
                      <UserX className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })()
            ) : (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setPersonDialogOpen(true)}
              >
                <span className="italic">+ Attribute Person</span>
              </Button>
            )}
          </div>

          <Dialog open={personDialogOpen} onOpenChange={(o) => { setPersonDialogOpen(o); if (!o) setNewPersonMode(false); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Attribute Person</DialogTitle>
              </DialogHeader>
              {newPersonMode ? (
                <div className="space-y-2">
                  <Input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="Name" autoFocus />
                  <Input value={newPersonRole} onChange={(e) => setNewPersonRole(e.target.value)} placeholder="Role (e.g. CEO)" />
                  <Button variant="ghost" size="sm" onClick={() => setNewPersonMode(false)}>
                    ← Pick existing person instead
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a person…" />
                    </SelectTrigger>
                    <SelectContent>
                      {persons.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {[p.name, p.role].filter(Boolean).join(" — ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => setNewPersonMode(true)}>
                    + New Person
                  </Button>
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPersonDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (newPersonMode) {
                      if (!newPersonName.trim()) return;
                      const id = createPerson({ name: newPersonName, role: newPersonRole || undefined });
                      waitForPersonId(id).then(() => updateGroup(group.id, { personId: id }));
                      setNewPersonName("");
                      setNewPersonRole("");
                    } else if (selectedPersonId) {
                      updateGroup(group.id, { personId: selectedPersonId });
                    }
                    setNewPersonMode(false);
                    setPersonDialogOpen(false);
                  }}
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Members table */}
          {group.members.length > 0 && (
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Role</th>
                    <th className="text-left px-3 py-2 font-medium">Address</th>
                    <th className="text-left px-3 py-2 font-medium">Label</th>
                    <th className="text-left px-3 py-2 font-medium">
                      Home Domain
                    </th>
                    <th className="text-left px-3 py-2 font-medium">Notes</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((m) =>
                    editingMemberId === m.id ? (
                      <tr
                        key={m.id}
                        className="border-b border-border bg-muted/10"
                      >
                        <td className="px-2 py-1.5">
                          <Select
                            value={memberEdit.role}
                            onValueChange={(v) =>
                              setMemberEdit((e) => ({
                                ...e,
                                role: v as GroupMemberRole,
                              }))
                            }
                          >
                            <SelectTrigger className="h-6 text-xs w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALL_ROLES.map((r) => (
                                <SelectItem
                                  key={r}
                                  value={r}
                                  className="text-xs"
                                >
                                  {ROLE_LABELS[r]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">
                          {shortAddr(m.address)}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={memberEdit.label}
                            onChange={(e) =>
                              setMemberEdit((s) => ({
                                ...s,
                                label: e.target.value,
                              }))
                            }
                            className="h-6 text-xs w-24"
                            placeholder="label"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={memberEdit.homeDomain}
                            onChange={(e) =>
                              setMemberEdit((s) => ({
                                ...s,
                                homeDomain: e.target.value,
                              }))
                            }
                            className="h-6 text-xs w-28"
                            placeholder="example.com"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={memberEdit.notes}
                            onChange={(e) =>
                              setMemberEdit((s) => ({
                                ...s,
                                notes: e.target.value,
                              }))
                            }
                            className="h-6 text-xs w-32"
                            placeholder="notes"
                          />
                        </td>
                        <td className="px-2 py-1.5 flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-green-500 hover:text-green-400"
                            onClick={() => saveMember(m)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => setEditingMemberId(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={m.id}
                        className="border-b border-border last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role]}`}
                          >
                            {ROLE_LABELS[m.role]}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          <ShortAddress address={m.address} network={network} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {m.label ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {m.homeDomain ? (
                            <a
                              href={`https://${m.homeDomain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                            >
                              <Globe className="h-3 w-3" />
                              {m.homeDomain}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {m.notes ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {(() => {
                            const walletEntry = walletMap.get(m.address);
                            const isActive = walletEntry && activeWallet?.id === walletEntry.id;
                            return (
                              <div className="flex items-center gap-1.5">
                                {walletEntry && (
                                  <>
                                    <span title={`Wallet: ${walletEntry.name} — you hold the key`}>
                                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-yellow-500/80" />
                                    </span>
                                    {isActive ? (
                                      <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/15 text-green-500 border border-green-500/30 leading-none">
                                        Active
                                      </span>
                                    ) : (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title={`Connect ${walletEntry.name}`}
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => connect(walletEntry.id)}
                                      >
                                        <Zap className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Open in Wallet Manager"
                                      className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                                      onClick={() => router.push("/wallet-manager")}
                                    >
                                      <Wallet className="h-3.5 w-3.5" />
                                    </Button>
                                    <span className="w-px h-3 bg-border mx-0.5" />
                                  </>
                                )}
                                <a
                                  href={`/address-investigator?address=${m.address}&network=${network}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title="Investigate"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={() => startEditMember(m)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive transition-colors"
                                  onClick={() => removeMember(group.id, m.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Add member */}
          {addingMember ? (
            <AddMemberForm
              groupId={group.id}
              onAdd={upsertMember}
              onCancel={() => setAddingMember(false)}
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddingMember(true)}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add Address
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create Group Form
// ---------------------------------------------------------------------------
function CreateGroupForm({
  onCreated,
  defaultNetwork,
}: {
  onCreated: (id: string) => void;
  defaultNetwork: string;
}) {
  const { groups, createGroup } = useAssetGroups();
  const [name, setName] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [network, setNetwork] = useState(defaultNetwork);
  const [nameError, setNameError] = useState<string | null>(null);

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const duplicate = groups.some(
      (g) => g.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      setNameError("A group with this name already exists.");
      return;
    }

    const id = createGroup({
      name: trimmed,
      assetCode: assetCode.trim() || undefined,
      issuer: issuer.trim() || undefined,
      network,
    });
    onCreated(id);
    setName("");
    setAssetCode("");
    setIssuer("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Asset Group
        </CardTitle>
        <CardDescription>
          Create a group to cluster all addresses related to one asset or
          investigation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3 space-y-1">
            <Label className="text-xs">Group Name *</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="e.g. XYZ Token Investigation"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Asset Code</Label>
            <Input
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder="XYZ"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Issuer Address</Label>
            <Input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="G…"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Network</Label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Mainnet</SelectItem>
                <SelectItem value="testnet">Testnet</SelectItem>
                <SelectItem value="futurenet">Futurenet</SelectItem>
                <SelectItem value="local">Local</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleCreate} disabled={!name.trim()}>
          <Plus className="h-4 w-4 mr-2" /> Create Group
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function GroupsPanel() {
  const { groups, isLoaded, upsertMember, updateMember, createGroup } =
    useAssetGroups();
  const { settings } = useSettings();
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL params
  const autoCreate = searchParams.get("autoCreate") === "1";
  const paramName = searchParams.get("name");
  const paramAssetCode = searchParams.get("assetCode");
  const paramIssuer = searchParams.get("issuer");
  const paramDistrib = searchParams.get("distrib");
  const paramIssuerHomeDomain = searchParams.get("issuerHomeDomain");
  const paramDistribHomeDomain = searchParams.get("distribHomeDomain");
  const paramNetwork = searchParams.get("network") ?? settings.network;
  const paramAddAddress = searchParams.get("addAddress");
  const paramAddRole = searchParams.get("addRole") as GroupMemberRole | null;
  const paramAddLabel = searchParams.get("addLabel");
  const paramAddHomeDomain = searchParams.get("addHomeDomain");

  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(
    searchParams.get("open") ?? null,
  );
  // Same-tab navigation to /groups?open=ID doesn't remount the page, so the
  // useState initializer never re-reads the param — sync it on change.
  const openParam = searchParams.get("open");
  useEffect(() => {
    if (openParam) setNewlyCreatedId(openParam);
  }, [openParam]);
  // Scroll the deep-linked/newly-created group into view once it renders.
  // groups.length dep so it also fires once the async group cache populates
  // on a hard load (deep link straight to /groups?open=ID).
  const scrolledForIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!newlyCreatedId) return;
    if (scrolledForIdRef.current === newlyCreatedId) return;
    const el = document.getElementById(`group-card-${newlyCreatedId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      scrolledForIdRef.current = newlyCreatedId;
    }
  }, [newlyCreatedId, groups.length]);
  const prefillHandledRef = useRef(false);
  const autoCreateAbortRef = useRef<AbortController | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  // Abort in-flight autoCreate work only on true unmount — the autoCreate
  // effect itself depends on `groups` (which updates during the async work),
  // so aborting in that effect's own cleanup would kill it permanently.
  useEffect(() => {
    return () => {
      autoCreateAbortRef.current?.abort();
    };
  }, []);

  // Auto-create group from "Save to Group" button — runs once on mount
  useEffect(() => {
    if (!isLoaded || prefillHandledRef.current || !autoCreate || !paramName)
      return;
    prefillHandledRef.current = true;

    const trimmedName = paramName.trim();

    const existingByAsset =
      paramAssetCode && paramIssuer
        ? groups.find(
            (g) =>
              g.assetCode?.toUpperCase() === paramAssetCode.toUpperCase() &&
              g.issuer === paramIssuer &&
              g.network === paramNetwork,
          )
        : undefined;
    const existingByName = groups.find(
      (g) => g.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    const existing = existingByAsset ?? existingByName;

    (async () => {
      const role: GroupMemberRole =
        paramAddRole && ALL_ROLES.includes(paramAddRole)
          ? paramAddRole
          : "other";

      const horizonUrl = resolveHorizonUrl({
        network: paramNetwork as Network,
        localHorizonUrl: settings.localHorizonUrl,
      });
      const abortController = new AbortController();
      autoCreateAbortRef.current = abortController;

      const [fetchedIssuerDomain, fetchedDistribDomain, fetchedAddDomain] =
        await Promise.all([
          paramIssuer && !paramIssuerHomeDomain
            ? fetchHomeDomain(horizonUrl, paramIssuer, abortController.signal).catch(
                (err) => {
                  console.warn("fetchHomeDomain (issuer) failed", err);
                  return undefined;
                },
              )
            : Promise.resolve(undefined),
          paramDistrib && !paramDistribHomeDomain
            ? fetchHomeDomain(horizonUrl, paramDistrib, abortController.signal).catch(
                (err) => {
                  console.warn("fetchHomeDomain (distrib) failed", err);
                  return undefined;
                },
              )
            : Promise.resolve(undefined),
          paramAddAddress && !paramAddHomeDomain
            ? fetchHomeDomain(
                horizonUrl,
                paramAddAddress,
                abortController.signal,
              ).catch((err) => {
                console.warn("fetchHomeDomain (addAddress) failed", err);
                return undefined;
              })
            : Promise.resolve(undefined),
        ]);

      if (abortController.signal.aborted) return;

      const issuerDomain = paramIssuerHomeDomain ?? fetchedIssuerDomain;
      const distribDomain = paramDistribHomeDomain ?? fetchedDistribDomain;
      const addDomain = paramAddHomeDomain ?? fetchedAddDomain;

      if (existing) {
        if (paramIssuer) {
          const issuerMember = existing.members.find(
            (m) => m.address === paramIssuer,
          );
          if (!issuerMember) {
            upsertMember(existing.id, {
              address: paramIssuer,
              role: "issuer",
              label: `Issuer ${paramAssetCode ?? ""}`.trim(),
              homeDomain: issuerDomain,
            });
          } else if (!issuerMember.homeDomain && issuerDomain) {
            updateMember(existing.id, issuerMember.id, {
              homeDomain: issuerDomain,
            });
          }
        }
        if (paramDistrib) {
          const distribMember = existing.members.find(
            (m) => m.address === paramDistrib,
          );
          if (!distribMember) {
            upsertMember(existing.id, {
              address: paramDistrib,
              role: "distributor",
              label: `Distrib ${paramAssetCode ?? ""}`.trim(),
              homeDomain: distribDomain,
            });
          } else if (!distribMember.homeDomain && distribDomain) {
            updateMember(existing.id, distribMember.id, {
              homeDomain: distribDomain,
            });
          }
        }
        if (paramAddAddress) {
          // If this member already exists in the group and has a custom label/role,
          // don't overwrite it — only add if not already present.
          const addMember = existing.members.find(
            (m) => m.address === paramAddAddress,
          );
          if (!addMember) {
            upsertMember(existing.id, {
              address: paramAddAddress,
              role,
              label: paramAddLabel ?? undefined,
              homeDomain: addDomain,
            });
          } else if (!addMember.homeDomain && addDomain) {
            updateMember(existing.id, addMember.id, {
              homeDomain: addDomain,
            });
          }
        }
        setNewlyCreatedId(existing.id);
        router.replace("/groups");
        return;
      }

      const createName = paramAssetCode
        ? `${paramAssetCode} Asset`
        : trimmedName;

      const id = createGroup({
        name: createName,
        assetCode: paramAssetCode ?? undefined,
        issuer: paramIssuer ?? undefined,
        network: paramNetwork,
      });
      if (paramIssuer) {
        upsertMember(id, {
          address: paramIssuer,
          role: "issuer",
          label: `Issuer ${paramAssetCode ?? ""}`.trim(),
          homeDomain: issuerDomain,
        });
      }
      if (paramDistrib) {
        upsertMember(id, {
          address: paramDistrib,
          role: "distributor",
          label: `Distrib ${paramAssetCode ?? ""}`.trim(),
          homeDomain: distribDomain,
        });
      }
      if (paramAddAddress) {
        upsertMember(id, {
          address: paramAddAddress,
          role,
          label: paramAddLabel ?? undefined,
          homeDomain: addDomain,
        });
      }
      const realId = await waitForGroupId(id);
      if (abortController.signal.aborted) return;
      setNewlyCreatedId(realId);
      router.replace("/groups");
    })();
  }, [
    isLoaded,
    autoCreate,
    paramName,
    paramAddRole,
    paramAssetCode,
    paramIssuer,
    groups,
    paramAddAddress,
    paramAddLabel,
    paramAddHomeDomain,
    createGroup,
    paramNetwork,
    paramIssuerHomeDomain,
    paramDistrib,
    paramDistribHomeDomain,
    settings.localHorizonUrl,
    upsertMember,
    updateMember,
    router,
  ]);

  const filtered = search.trim()
    ? groups.filter(
        (g) =>
          g.id === newlyCreatedId ||
          g.name.toLowerCase().includes(search.toLowerCase()) ||
          g.assetCode?.toLowerCase().includes(search.toLowerCase()) ||
          g.members.some(
            (m) =>
              m.address.toLowerCase().includes(search.toLowerCase()) ||
              m.label?.toLowerCase().includes(search.toLowerCase()) ||
              m.homeDomain?.toLowerCase().includes(search.toLowerCase()),
          ),
      )
    : groups;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          onClick={() => setShowCreate((v) => !v)}
          variant={showCreate ? "outline" : "default"}
        >
          <Plus className="h-4 w-4 mr-2" />
          {showCreate ? "Cancel" : "New Group"}
        </Button>
      </div>

      {showCreate && (
        <CreateGroupForm
          defaultNetwork={settings.network}
          onCreated={(id) => {
            setNewlyCreatedId(id);
            setShowCreate(false);
          }}
        />
      )}

      {groups.length > 3 && (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search groups, addresses, labels, domains…"
        />
      )}

      {!isLoaded && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading groups…
        </div>
      )}

      {isLoaded && filtered.length === 0 && !showCreate && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-20" />
          No groups yet. Create one to start clustering addresses.
        </div>
      )}

      {isLoaded && (
        <div className="space-y-4">
          {[...filtered]
            .sort((a, b) =>
              a.id === newlyCreatedId ? -1 : b.id === newlyCreatedId ? 1 : 0,
            )
            .map((g) => (
              <div key={g.id} id={`group-card-${g.id}`}>
                <GroupCard group={g} defaultOpen={g.id === newlyCreatedId} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
