"use client";

import { StrKey } from "stellar-sdk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ChevronDown, ChevronUp, BookUser, Plus, Trash2 } from "lucide-react";
import { ShortAddress } from "@/components/shared/ShortAddress";
import type { PaymentsController } from "./usePaymentsController";

type PaymentsAddressBookProps = Pick<PaymentsController,
  | "setAddressBookOpen"
  | "addressBookOpen"
  | "addressBookEntries"
  | "handleSelectAddress"
  | "network"
  | "handleRemoveAddress"
  | "newLabel"
  | "setNewLabel"
  | "newKey"
  | "setNewKey"
  | "handleAddAddress"
>;

export function PaymentsAddressBook({
  setAddressBookOpen,
  addressBookOpen,
  addressBookEntries,
  handleSelectAddress,
  network,
  handleRemoveAddress,
  newLabel,
  setNewLabel,
  newKey,
  setNewKey,
  handleAddAddress,
}: PaymentsAddressBookProps) {
  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none pb-3 pt-3 px-4"
        onClick={() => setAddressBookOpen(!addressBookOpen)}
      >
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BookUser className="h-3.5 w-3.5" />
            Address Book
            {addressBookEntries.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">({addressBookEntries.length})</span>
            )}
          </span>
          {addressBookOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>
      {addressBookOpen && (
        <CardContent className="space-y-4">
          {addressBookEntries.length > 0 ? (
            <div className="space-y-2">
              {addressBookEntries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
                >
                  {/* Plain div (not <button>) — ShortAddress renders its own interactive
                        copy/link controls, so nesting it inside a <button> would produce
                        invalid nested interactive elements. */}
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex-1 text-left cursor-pointer"
                    onClick={() => handleSelectAddress(entry.publicKey)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectAddress(entry.publicKey);
                      }
                    }}
                  >
                    <div className="text-sm font-medium">{entry.label}</div>
                    <div className="text-xs font-mono text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      <ShortAddress address={entry.publicKey} network={network} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveAddress(i)}
                    className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              No saved addresses yet.
            </p>
          )}

          {/* Add new address */}
          <div className="border-t border-border pt-4 space-y-3">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
              Add New Address
            </Label>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
              <Input
                placeholder="Label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <Input
                placeholder="G..."
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleAddAddress}
                disabled={!newLabel.trim() || !StrKey.isValidEd25519PublicKey(newKey.trim())}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {newKey.trim() && !StrKey.isValidEd25519PublicKey(newKey.trim()) && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Invalid Stellar public key.
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
