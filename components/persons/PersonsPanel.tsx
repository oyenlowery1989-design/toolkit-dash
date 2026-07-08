"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Trash2, Pencil, Check, X, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePersons } from "@/hooks/use-persons";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import type { Person } from "@/lib/persons/types";

function PersonCard({ person }: { person: Person }) {
  const { updatePerson, deletePerson, addPersonAddress, removePersonAddress } = usePersons();
  const { groups } = useAssetGroups();
  const { settings } = useSettings();

  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(person.name);
  const [roleVal, setRoleVal] = useState(person.role ?? "");
  const [notesVal, setNotesVal] = useState(person.notes ?? "");
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newAddressLabel, setNewAddressLabel] = useState("");

  const attributedGroups = groups.filter((g) => g.personId === person.id);

  function save() {
    updatePerson(person.id, {
      name: nameVal.trim() || person.name,
      role: roleVal.trim() || undefined,
      notes: notesVal.trim() || undefined,
    });
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex flex-col gap-2">
                <Input value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="h-7 text-sm font-semibold" autoFocus />
                <Input value={roleVal} onChange={(e) => setRoleVal(e.target.value)} className="h-7 text-xs" placeholder="Role (e.g. CEO)" />
                <Input value={notesVal} onChange={(e) => setNotesVal(e.target.value)} className="h-7 text-xs" placeholder="Notes" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={save}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  {person.name}
                  {person.role && <span className="text-muted-foreground font-normal ml-1.5">— {person.role}</span>}
                </CardTitle>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {!editing && person.notes && <p className="text-xs text-muted-foreground mt-1">{person.notes}</p>}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => {
              if (window.confirm(`Delete "${person.name}"? This unlinks them from ${attributedGroups.length} asset group(s) and removes their ${person.addresses.length} linked address(es).`)) {
                deletePerson(person.id);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Addresses</Label>
          <div className="space-y-1">
            {person.addresses.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <ShortAddress address={a.address} network={settings.network} />
                {a.label && <span className="text-muted-foreground">{a.label}</span>}
                <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => removePersonAddress(person.id, a.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          {addingAddress ? (
            <div className="flex gap-2">
              <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} className="text-xs font-mono" placeholder="G..." autoFocus />
              <Input value={newAddressLabel} onChange={(e) => setNewAddressLabel(e.target.value)} className="text-xs" placeholder="Label (optional)" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (newAddress.trim()) {
                    addPersonAddress(person.id, { address: newAddress.trim(), label: newAddressLabel.trim() || undefined });
                  }
                  setNewAddress("");
                  setNewAddressLabel("");
                  setAddingAddress(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setAddingAddress(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add address
            </Button>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Attributed to {attributedGroups.length} asset group(s)</Label>
          {attributedGroups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attributedGroups.map((g) => (
                <Link key={g.id} href={`/groups?open=${g.id}`} className="text-xs px-2 py-0.5 rounded-full bg-accent hover:bg-accent/70 transition-colors">
                  {g.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonsPanel() {
  const { persons, isLoaded, createPerson } = usePersons();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  if (!isLoaded) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. CEO)" />
            <Button
              onClick={() => {
                if (!name.trim()) return;
                createPerson({ name, role: role || undefined });
                setName("");
                setRole("");
              }}
            >
              <UserPlus className="h-4 w-4 mr-1.5" /> Add Person
            </Button>
          </div>
        </CardContent>
      </Card>
      {persons.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No persons yet — add one above.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {persons.map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  );
}
