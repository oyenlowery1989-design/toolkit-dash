"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { AlertTriangle, Info } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/asset-groups/types";
import type {
  AssetGroup,
  GroupMember,
  GroupMemberRole,
} from "@/lib/asset-groups/types";
import { ShortAddress } from "@/components/asset-lookup";

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
    deleteGroup,
    upsertMember,
    updateMember,
    removeMember,
  } = useAssetGroups();
  const { settings } = useSettings();
  const network = (settings.network as "public" | "testnet") ?? "public";

  const [open, setOpen] = useState(defaultOpen ?? false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group.name);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(group.notes ?? "");
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
      setNameVal(group.name);
      setEditingName(false);
      return;
    }

    updateGroup(group.id, { name: trimmed });
    setEditingName(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  className="h-7 text-sm font-semibold"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      saveGroupName();
                    }
                    if (e.key === "Escape") {
                      setNameVal(group.name);
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
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <button
                  onClick={() => setEditingName(true)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {group.assetCode && (
              <CardDescription className="mt-0.5">
                {group.assetCode}
                {group.issuer && (
                  <span className="font-mono ml-1 text-xs">
                    {group.issuer.slice(0, 4)}…{group.issuer.slice(-4)}
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
              onClick={() => deleteGroup(group.id)}
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
              <button
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 border border-dashed border-border hover:border-muted-foreground transition-colors"
                onClick={() => setEditingNotes(true)}
              >
                {group.notes || (
                  <span className="italic">Add investigation notes…</span>
                )}
              </button>
            )}
          </div>

          {/* Members table */}
          {group.members.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Role</th>
                    <th className="text-left px-3 py-2 font-medium">Address</th>
                    <th className="text-left px-3 py-2 font-medium">Label</th>
                    <th className="text-left px-3 py-2 font-medium">
                      Home Domain
                    </th>
                    <th className="text-left px-3 py-2 font-medium">Notes</th>
                    <th className="px-3 py-2 w-16" />
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
                          {m.address.slice(0, 4)}…{m.address.slice(-4)}
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
                          <button
                            onClick={() => saveMember(m)}
                            className="text-green-500 hover:text-green-400"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingMemberId(null)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
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
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`/address-investigator?address=${m.address}&network=${network}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Investigate"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <button
                              onClick={() => startEditMember(m)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => removeMember(group.id, m.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
// Page
// ---------------------------------------------------------------------------
export default function GroupsPage() {
  const { groups, isLoaded, upsertMember, createGroup } = useAssetGroups();
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
  const prefillHandledRef = useRef(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  // Auto-create group from "Save to Group" button — runs once on mount
  useEffect(() => {
    if (!isLoaded || prefillHandledRef.current || !autoCreate || !paramName)
      return;
    prefillHandledRef.current = true;

    const role: GroupMemberRole =
      paramAddRole && ALL_ROLES.includes(paramAddRole) ? paramAddRole : "other";

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

    if (existing) {
      if (paramAddAddress) {
        // If this member already exists in the group and has a custom label/role,
        // don't overwrite it — only add if not already present.
        const alreadyMember = existing.members.find(
          (m) => m.address === paramAddAddress,
        );
        if (!alreadyMember) {
          upsertMember(existing.id, {
            address: paramAddAddress,
            role,
            label: paramAddLabel ?? undefined,
            homeDomain: paramAddHomeDomain ?? undefined,
          });
        }
      }
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
        homeDomain: paramIssuerHomeDomain ?? undefined,
      });
    }
    if (paramDistrib) {
      upsertMember(id, {
        address: paramDistrib,
        role: "distributor",
        label: `Distrib ${paramAssetCode ?? ""}`.trim(),
        homeDomain: paramDistribHomeDomain ?? undefined,
      });
    }
    if (paramAddAddress) {
      upsertMember(id, {
        address: paramAddAddress,
        role,
        label: paramAddLabel ?? undefined,
        homeDomain: paramAddHomeDomain ?? undefined,
      });
    }
    router.replace("/groups");
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
    upsertMember,
    router,
  ]);

  const filtered = search.trim()
    ? groups.filter(
        (g) =>
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
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Asset Groups</h1>
            <p className="text-sm text-muted-foreground">
              Cluster related addresses — issuer, distributor, creator, bank,
              withdrawal — into case files.
            </p>
          </div>
        </div>
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

      {filtered.length === 0 && !showCreate && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-20" />
          No groups yet. Create one to start clustering addresses.
        </div>
      )}

      <div className="space-y-4">
        {[...filtered]
          .sort((a, b) =>
            a.id === newlyCreatedId ? -1 : b.id === newlyCreatedId ? 1 : 0,
          )
          .map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              defaultOpen={g.id === newlyCreatedId}
            />
          ))}
      </div>
    </div>
  );
}
