import { AsyncLocalStorage } from "node:async_hooks";
import { renewRunLease, type RunLeaseTable } from "@/lib/run-lease";
const context = new AsyncLocalStorage<{ table: RunLeaseTable; id: string; token: string }>();
export function withLeaseContext<T>(table: RunLeaseTable, id: string, token: string, fn: () => Promise<T>): Promise<T> {
  return context.run({ table, id, token }, fn);
}
export async function assertExecutionLease(): Promise<void> {
  const lease = context.getStore();
  if (lease) await renewRunLease(lease.table, lease.id, lease.token);
}
