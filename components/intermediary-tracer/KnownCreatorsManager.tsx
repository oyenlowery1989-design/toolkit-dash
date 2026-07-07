"use client";

import { useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { StrKey } from "stellar-sdk";
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
import { useKnownCreators } from "@/hooks/use-known-creators";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { useSettings } from "@/lib/settings";
import type { KnownCreator } from "@/lib/intermediary-tracer/types";

function AddForm({ onClose }: { onClose: () => void }) {
  const { upsert } = useKnownCreators();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const addrValid = StrKey.isValidEd25519PublicKey(address.trim());
  const canSave = addrValid && name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    upsert({ address: address.trim(), name: name.trim(), notes: notes.trim() || undefined });
    setSaved(true);
    setTimeout(onClose, 600);
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-sm font-medium">Add Known Creator</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Address</Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="GXXXXXX…"
            className="font-mono text-xs"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Name / Label</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Whale A, Exchange Hot Wallet"
            className="text-xs"
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes (optional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Description…"
            className="text-xs"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={!canSave || saved} className="h-7 text-xs">
          {saved ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Plus className="h-3 w-3 mr-1" />}
          {saved ? "Saved!" : "Add"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: KnownCreator }) {
  const { remove, upsert } = useKnownCreators();
  const { settings } = useSettings();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [notes, setNotes] = useState(entry.notes ?? "");

  const handleSave = () => {
    upsert({ ...entry, name: name.trim() || entry.name, notes: notes.trim() || undefined });
    setEditing(false);
  };

  return (
    <div className="rounded-md border border-border bg-muted/10 p-3 space-y-1">
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xs h-7"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            />
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes…"
              className="text-xs h-7"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-6 text-xs" onClick={handleSave}>
              <Check className="h-3 w-3 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditing(false)}>
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{entry.name}</span>
            </div>
            <div className="mt-0.5">
              <ShortAddress
                address={entry.address}
                network={settings.network as "public" | "testnet"}
              />
            </div>
            {entry.notes && (
              <p className="text-xs text-muted-foreground mt-1">{entry.notes}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Added {new Date(entry.addedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-destructive hover:text-destructive"
              onClick={() => remove(entry.address)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function KnownCreatorsManager() {
  const { entries } = useKnownCreators();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Known Real Creators</CardTitle>
            <CardDescription className="mt-1">
              Addresses identified as the real funders behind intermediary-created accounts.
              When found as a top candidate in any scan, they will be labeled automatically.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)} disabled={showAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && <AddForm onClose={() => setShowAdd(false)} />}
        {entries.length === 0 && !showAdd ? (
          <p className="text-sm text-muted-foreground">
            No known creators yet. After running a scan, use the "Add to Known Creators" button
            on a candidate to save them here.
          </p>
        ) : (
          entries.map((e) => <EntryRow key={e.address} entry={e} />)
        )}
      </CardContent>
    </Card>
  );
}
