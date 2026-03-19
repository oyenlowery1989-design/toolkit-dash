"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { StrKey } from "stellar-sdk";
import {
  BookUser,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAddressBook,
  ADDRESS_COLORS,
  type AddressBookEntry,
  type AddressColor,
} from "@/hooks/use-address-book";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useKnownCreators } from "@/hooks/use-known-creators";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function short(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Color picker
// ---------------------------------------------------------------------------

function ColorPicker({
  value,
  onChange,
}: {
  value?: AddressColor;
  onChange: (c: AddressColor | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Color:</span>
      {(Object.keys(ADDRESS_COLORS) as AddressColor[]).map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(value === c ? undefined : c)}
          className={`h-5 w-5 rounded-full transition-all ${ADDRESS_COLORS[c].dot} ${
            value === c
              ? "ring-2 ring-offset-2 ring-offset-background " + ADDRESS_COLORS[c].ring
              : "opacity-50 hover:opacity-100"
          }`}
        />
      ))}
      {value && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          clear
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry form (add / edit)
// ---------------------------------------------------------------------------

interface EntryFormProps {
  initial?: AddressBookEntry;
  prefillAddress?: string;
  prefillLabel?: string;
  prefillNotes?: string;
  onSave: (entry: Omit<AddressBookEntry, "timestamp">) => void;
  onCancel: () => void;
}

function EntryForm({ initial, prefillAddress, prefillLabel, prefillNotes, onSave, onCancel }: EntryFormProps) {
  const [publicKey, setPublicKey] = useState(initial?.publicKey ?? prefillAddress ?? "");
  const [label, setLabel] = useState(initial?.label ?? prefillLabel ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? prefillNotes ?? "");
  const [color, setColor] = useState<AddressColor | undefined>(initial?.color);
  const [addrError, setAddrError] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  const { entries: intermediaries } = useKnownIntermediaries();
  const { entries: creators } = useKnownCreators();
  const { groups } = useAssetGroups();

  // Live conflict detection — runs whenever the typed address changes
  const conflict = (() => {
    const pk = publicKey.trim();
    if (!pk || initial) return null; // don't warn when editing existing entry

    const intermediary = intermediaries.find((e) => e.address === pk);
    if (intermediary)
      return { label: intermediary.name, type: "Known Intermediary", href: null };

    const creator = creators.find((e) => e.address === pk);
    if (creator)
      return { label: creator.name, type: "Known Creator", href: null };

    for (const g of groups) {
      const member = g.members.find((m) => m.address === pk);
      if (member)
        return {
          label: member.label || member.role.toUpperCase(),
          type: `Asset Group "${g.name}"`,
          href: `/groups?highlight=${g.id}`,
        };
    }
    return null;
  })();

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const handleSave = () => {
    const pk = publicKey.trim();
    const lbl = label.trim();
    if (!pk) { setAddrError("Address is required"); return; }
    if (!StrKey.isValidEd25519PublicKey(pk)) { setAddrError("Invalid Stellar public key"); return; }
    if (!lbl) return;
    onSave({ publicKey: pk, label: lbl, notes: notes.trim() || undefined, color });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ab-addr">Stellar Address</Label>
          <Input
            id="ab-addr"
            value={publicKey}
            onChange={(e) => { setPublicKey(e.target.value); setAddrError(null); }}
            placeholder="GXXXXXX..."
            className="font-mono text-xs"
            disabled={!!initial}
          />
          {addrError && (
            <p className="text-xs text-destructive">{addrError}</p>
          )}
          {conflict && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-400/40 bg-yellow-400/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
              <span className="shrink-0 mt-px">⚠</span>
              <span>
                Already saved in <span className="font-semibold">{conflict.type}</span>{" "}
                as <span className="font-semibold">{conflict.label}</span>.
                {conflict.href && (
                  <>
                    {" "}
                    <a
                      href={conflict.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-yellow-600 dark:hover:text-yellow-300"
                    >
                      View group →
                    </a>
                  </>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ab-label">Name / Label</Label>
          <Input
            id="ab-label"
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. USDC Issuer, WhipLash Distrib…"
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ab-notes">Notes (optional)</Label>
        <Input
          id="ab-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any relevant notes…"
        />
      </div>

      <ColorPicker value={color} onChange={setColor} />

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={!label.trim() || !publicKey.trim()}>
          <Check className="mr-1.5 h-3.5 w-3.5" />
          {initial ? "Update" : "Add Entry"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import panel
// ---------------------------------------------------------------------------

function ImportPanel({
  onImport,
  onClose,
}: {
  onImport: (text: string) => number;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const handleImport = () => {
    const count = onImport(text);
    setResult(
      count > 0
        ? `✓ Imported ${count} address${count !== 1 ? "es" : ""}`
        : "No valid entries found. Use format: GXXX...=Label (one per line)",
    );
    if (count > 0) setText("");
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Bulk Import</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          One entry per line. Formats accepted:
          <code className="ml-1 text-[10px] bg-muted px-1 rounded">GXXX...=Name</code>
          <code className="ml-1 text-[10px] bg-muted px-1 rounded">GXXX... Name</code>
        </p>
      </div>
      <textarea
        className="w-full min-h-32 rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono"
        placeholder={"GCFI3W...SY2Z=WhipLash Distrib\nGA5Z...=USDC Issuer"}
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
      />
      {result && (
        <p className={`text-xs ${result.startsWith("✓") ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {result}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleImport} disabled={!text.trim()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Import
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  onEdit,
  onRemove,
}: {
  entry: AddressBookEntry;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const colorStyle = entry.color ? ADDRESS_COLORS[entry.color] : null;
  const explorerUrl = `https://stellar.expert/explorer/public/account/${entry.publicKey}`;

  const copy = () => {
    navigator.clipboard.writeText(entry.publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3 py-3 px-1">
        {/* Color dot / expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 flex items-center gap-1.5 text-muted-foreground"
        >
          {colorStyle ? (
            <span className={`h-2.5 w-2.5 rounded-full ${colorStyle.dot}`} />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          )}
          {entry.notes ? (
            expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
          ) : null}
        </button>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <span
            className={`text-sm font-semibold ${colorStyle ? colorStyle.text : "text-foreground"}`}
          >
            {entry.label}
          </span>
        </div>

        {/* Address */}
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground font-mono">
          <button onClick={copy} title="Copy address" className="hover:text-foreground transition-colors">
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
          {short(entry.publicKey)}
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
            title="Open in Stellar.Expert"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Added */}
        <span className="hidden lg:block text-xs text-muted-foreground w-16 text-right shrink-0">
          {timeAgo(entry.timestamp)}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded notes + full address */}
      {expanded && (
        <div className="pb-3 pl-7 pr-1 space-y-1">
          <p className="text-xs font-mono text-muted-foreground break-all">{entry.publicKey}</p>
          {entry.notes && (
            <p className="text-xs text-muted-foreground">{entry.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AddressBookPanel() {
  const { entries, upsert, remove, importBulk } = useAddressBook();
  const searchParams = useSearchParams();

  const [filter, setFilter] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [prefillAddress, setPrefillAddress] = useState<string | undefined>();
  const [prefillLabel, setPrefillLabel] = useState<string | undefined>();
  const [prefillNotes, setPrefillNotes] = useState<string | undefined>();

  // Pre-fill from URL ?add=ADDRESS&label=NAME&notes=NOTES
  useEffect(() => {
    const addAddr = searchParams.get("add");
    if (addAddr && StrKey.isValidEd25519PublicKey(addAddr)) {
      setPrefillAddress(addAddr);
      setPrefillLabel(searchParams.get("label") ?? undefined);
      setPrefillNotes(searchParams.get("notes") ?? undefined);
      setShowAddForm(true);
    }
  }, [searchParams]);

  const filtered = entries.filter(
    (e) =>
      e.label.toLowerCase().includes(filter.toLowerCase()) ||
      e.publicKey.toLowerCase().includes(filter.toLowerCase()) ||
      (e.notes ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  const handleExport = () => {
    const lines = entries.map((e) => `${e.publicKey}=${e.label}`).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stellar-address-book.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Address Book</h1>
        <p className="text-muted-foreground mt-2">
          Assign private names to Stellar addresses. Names appear everywhere across the toolkit wherever an address is displayed.
        </p>
      </div>

      {/* Add / Import forms */}
      {showAddForm && (
        <EntryForm
          prefillAddress={prefillAddress}
          prefillLabel={prefillLabel}
          prefillNotes={prefillNotes}
          onSave={(entry) => {
            upsert(entry);
            toast.success("Address saved");
            setShowAddForm(false);
            setPrefillAddress(undefined);
            setPrefillLabel(undefined);
            setPrefillNotes(undefined);
          }}
          onCancel={() => {
            setShowAddForm(false);
            setPrefillAddress(undefined);
            setPrefillLabel(undefined);
            setPrefillNotes(undefined);
          }}
        />
      )}
      {showImport && !showAddForm && (
        <ImportPanel
          onImport={importBulk}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Main card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookUser className="h-5 w-5" />
                Named Addresses
                {entries.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    ({entries.length})
                  </span>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                Names are stored locally in your browser and never leave your device.
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              {entries.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowImport((v) => !v); setShowAddForm(false); }}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import
              </Button>
              <Button
                size="sm"
                onClick={() => { setShowAddForm((v) => !v); setShowImport(false); setPrefillAddress(undefined); }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Entry
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {entries.length === 0 && !showAddForm ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
              <BookUser className="h-10 w-10 opacity-20" />
              <p className="text-sm">No named addresses yet.</p>
              <p className="text-xs max-w-sm">
                Add a name for any Stellar address — it will appear everywhere across the toolkit instead of the raw address.
              </p>
              <Button size="sm" onClick={() => setShowAddForm(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add First Entry
              </Button>
            </div>
          ) : (
            <>
              {entries.length > 5 && (
                <div className="relative mb-4">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, address, or notes…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="pl-9"
                  />
                  {filter && (
                    <button
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setFilter("")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Column headers */}
              {filtered.length > 0 && (
                <div className="flex items-center gap-3 px-1 pb-2 border-b border-border text-xs text-muted-foreground font-medium">
                  <span className="w-4 shrink-0" />
                  <span className="flex-1">Name</span>
                  <span className="hidden md:block">Address</span>
                  <span className="hidden lg:block w-16 text-right">Added</span>
                  <span className="w-16 shrink-0" />
                </div>
              )}

              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No entries match &ldquo;{filter}&rdquo;.
                </p>
              ) : (
                filtered.map((entry) =>
                  editKey === entry.publicKey ? (
                    <div key={entry.publicKey} className="py-3">
                      <EntryForm
                        initial={entry}
                        onSave={(updated) => {
                          upsert(updated);
                          setEditKey(null);
                        }}
                        onCancel={() => setEditKey(null)}
                      />
                    </div>
                  ) : (
                    <EntryRow
                      key={entry.publicKey}
                      entry={entry}
                      onEdit={() => setEditKey(entry.publicKey)}
                      onRemove={() => { remove(entry.publicKey); toast.success("Address removed"); }}
                    />
                  ),
                )
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
