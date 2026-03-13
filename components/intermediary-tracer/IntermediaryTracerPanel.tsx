"use client";

import { useState } from "react";
import { GitFork } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TraceAccountTab } from "./TraceAccountTab";
import { ScanIntermediaryTab } from "./ScanIntermediaryTab";
import { KnownIntermediariesManager } from "./KnownIntermediariesManager";
import { KnownCreatorsManager } from "./KnownCreatorsManager";
import { TraceCreatorTab } from "./TraceCreatorTab";

export function IntermediaryTracerPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <GitFork className="h-7 w-7" />
          Intermediary Tracer
        </h1>
        <p className="text-muted-foreground mt-2">
          Trace the real origin of Stellar accounts created through exchange intermediaries
          (ChangeNow, SimpleSwap, etc.) by correlating incoming payments with{" "}
          <code className="text-xs">create_account</code> operations.
        </p>
      </div>

      <Tabs defaultValue="trace">
        <TabsList>
          <TabsTrigger value="trace">Trace Single Account</TabsTrigger>
          <TabsTrigger value="scan">Scan Intermediary</TabsTrigger>
          <TabsTrigger value="intermediaries">Known Intermediaries</TabsTrigger>
          <TabsTrigger value="creators">Known Creators</TabsTrigger>
          <TabsTrigger value="trace-creator">Creator's Accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="trace" className="mt-6">
          <TraceAccountTab />
        </TabsContent>

        <TabsContent value="scan" className="mt-6">
          <ScanIntermediaryTab />
        </TabsContent>

        <TabsContent value="intermediaries" className="mt-6">
          <KnownIntermediariesManager />
        </TabsContent>

        <TabsContent value="creators" className="mt-6">
          <KnownCreatorsManager />
        </TabsContent>

        <TabsContent value="trace-creator" className="mt-6">
          <TraceCreatorTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
