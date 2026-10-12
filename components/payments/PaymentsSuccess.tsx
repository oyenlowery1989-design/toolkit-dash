"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Send, Copy, Check } from "lucide-react";
import { NETWORK_LABELS } from "@/lib/settings";
import type { PaymentsController } from "./usePaymentsController";

type PaymentsSuccessProps = Pick<PaymentsController,
  | "network"
  | "txHash"
  | "handleCopyHash"
  | "copied"
  | "handleReset"
>;

export function PaymentsSuccess({ network, txHash, handleCopyHash, copied, handleReset }: PaymentsSuccessProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Payments</h1>
      </div>

      <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <Check className="h-5 w-5" />
            Transaction Submitted
          </CardTitle>
          <CardDescription>
            Your transaction was signed and submitted to the {NETWORK_LABELS[network]}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Transaction Hash</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                {txHash}
              </code>
              <Button variant="outline" size="icon" onClick={handleCopyHash} className="shrink-0">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleReset} className="w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" />
            Send Another
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
