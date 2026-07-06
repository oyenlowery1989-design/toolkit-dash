"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FingerprintTab } from "./FingerprintTab";

export function TracerV2Panel() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tracer v2</h1>
        <p className="text-muted-foreground mt-2">
          Correlate asset groups by shared operators using data already collected across the toolkit.
        </p>
      </div>
      <Tabs defaultValue="fingerprint">
        <TabsList className="flex-wrap h-auto gap-y-1">
          <TabsTrigger value="fingerprint">Operator Fingerprint</TabsTrigger>
        </TabsList>
        <TabsContent value="fingerprint" className="mt-6 space-y-4">
          <FingerprintTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
