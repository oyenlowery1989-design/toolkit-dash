"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SingleTrustlineTab } from "./SingleTrustlineTab";
import { BulkTrustlineTab } from "./BulkTrustlineTab";

export function TrustlineManagerPanel() {
  const [tab, setTab] = useState("single");

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="single">Single</TabsTrigger>
        <TabsTrigger value="bulk">Bulk</TabsTrigger>
      </TabsList>

      <TabsContent value="single" className="mt-6">
        <SingleTrustlineTab />
      </TabsContent>

      <TabsContent value="bulk" className="mt-6">
        <BulkTrustlineTab />
      </TabsContent>
    </Tabs>
  );
}
