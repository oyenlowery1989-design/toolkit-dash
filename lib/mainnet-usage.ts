import { deploymentUsage } from "@/lib/transaction-budget";
// One rolling deployment-wide budget covers all accounts and application features.
export async function autoSendXlmLast24Hours(_walletAddress: string, _now?: number): Promise<number> {
  return deploymentUsage();
}
export async function tieredRewardXlmLast24Hours(_userId?: string, _now?: number): Promise<number> {
  return deploymentUsage();
}
