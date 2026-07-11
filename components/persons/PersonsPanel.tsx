"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePersons } from "@/hooks/use-persons";
import { PersonCard } from "@/components/persons/PersonCard";
import { TelegramChannelClusters } from "@/components/persons/TelegramChannelClusters";
import { RelationshipClusters } from "@/components/persons/RelationshipClusters";

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
      <TelegramChannelClusters />
      <RelationshipClusters />
    </div>
  );
}
