"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2, Pencil, Check, X, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePersons } from "@/hooks/use-persons";
import { useConfirmClick } from "@/hooks/use-confirm-click";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useSettings } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import type { Person } from "@/lib/persons/types";
import { telegramChannelsForPerson } from "@/lib/persons/telegram-channels";
import { resolveTelegramUrl } from "@/lib/asset-groups/links";
import { groupsForAddress } from "@/lib/persons/address-groups";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/asset-groups/types";

export function PersonCard({ person }: { person: Person }) {
  const { updatePerson, deletePerson, addPersonAddress, removePersonAddress } = usePersons();
  const { groups } = useAssetGroups();
  const { settings } = useSettings();

  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(person.name);
  const [roleVal, setRoleVal] = useState(person.role ?? "");
  const [notesVal, setNotesVal] = useState(person.notes ?? "");
  const [telegramVal, setTelegramVal] = useState(person.telegramUsername ?? "");
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newAddressLabel, setNewAddressLabel] = useState("");

  const attributedGroups = groups.filter((g) => g.personId === person.id);
  const { confirming: confirmingDelete, onClick: handleDeleteClick } = useConfirmClick(() => deletePerson(person.id));

  function save() {
    updatePerson(person.id, {
      name: nameVal.trim() || person.name,
      role: roleVal.trim() || undefined,
      notes: notesVal.trim() || undefined,
      telegramUsername: telegramVal.trim() || undefined,
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
                <Input value={telegramVal} onChange={(e) => setTelegramVal(e.target.value)} className="h-7 text-xs" placeholder="Telegram username (e.g. @alice)" />
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
            {!editing && person.telegramUsername && (
              <a
                href={resolveTelegramUrl(person.telegramUsername)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline mt-0.5 inline-block"
              >
                @{person.telegramUsername.replace(/^@/, "")}
              </a>
            )}
          </div>
          <Button
            size={confirmingDelete ? "sm" : "icon"}
            variant="ghost"
            className={
              confirmingDelete
                ? "h-8 px-2 text-xs font-semibold whitespace-nowrap bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive"
                : "h-7 w-7 text-destructive hover:text-destructive"
            }
            title={
              confirmingDelete
                ? "Click again to confirm delete"
                : `Delete — unlinks from ${attributedGroups.length} asset group(s), removes ${person.addresses.length} linked address(es)`
            }
            onClick={handleDeleteClick}
          >
            {confirmingDelete ? "Confirm delete" : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Addresses</Label>
          <div className="space-y-1">
            {person.addresses.map((a) => {
              const addressGroups = groupsForAddress(a.address, groups);
              return (
                <div key={a.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <ShortAddress address={a.address} network={settings.network} />
                    {a.label && <span className="text-muted-foreground">{a.label}</span>}
                    <Button size="icon" variant="ghost" className="h-5 w-5 ml-auto" onClick={() => removePersonAddress(person.id, a.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  {addressGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-1">
                      {addressGroups.map((g) => {
                        const member = g.members.find((m) => m.address === a.address)!;
                        return (
                          <Link
                            key={g.id}
                            href={`/groups?open=${g.id}`}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full hover:opacity-80 transition-opacity ${ROLE_COLORS[member.role]}`}
                          >
                            {g.name} · {ROLE_LABELS[member.role]}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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
        {(() => {
          const channels = telegramChannelsForPerson(person, groups);
          if (channels.length === 0) return null;
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Related Telegram channels</Label>
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <a
                    key={c.key}
                    href={resolveTelegramUrl(c.raw, c.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-0.5 rounded-full bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition-colors"
                  >
                    @{c.key}
                  </a>
                ))}
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
