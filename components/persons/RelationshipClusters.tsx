"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePersons } from "@/hooks/use-persons";
import { computeClusters } from "@/lib/persons/relationship-clusters";

export function RelationshipClusters() {
  const [show, setShow] = useState(false);
  const { persons } = usePersons();

  const clusters = useMemo(() => computeClusters(persons), [persons]);

  if (clusters.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Connected Persons</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Groups of persons linked by relationships (friend/colleague/invited-by), including transitive connections.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {show && (
        <CardContent className="pt-0">
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Members</th>
                  <th className="px-3 py-2 text-right font-medium">Relationships</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <tr key={c.personIds.slice().sort().join(",")} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      {c.personIds
                        .map((id) => persons.find((p) => p.id === id)?.name ?? "Unknown person")
                        .join(", ")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{c.edgeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
