import { authHeaders, waitForAuth } from "@/lib/db-client";
import type { BulkPaymentJournal } from "./types";

const ENDPOINT = "/api/db/bulk-payment-journal";

async function request(method: "GET" | "POST" | "DELETE", body?: unknown): Promise<unknown> {
  await waitForAuth();
  const response = await fetch(ENDPOINT, {
    method,
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Bulk journal failed (${response.status})`);
  }
  return response.json();
}

export async function loadBulkJournal(): Promise<BulkPaymentJournal | null> {
  return request("GET") as Promise<BulkPaymentJournal | null>;
}

export async function saveBulkJournal(journal: BulkPaymentJournal, expectedVersion: number | null): Promise<BulkPaymentJournal> {
  const data = await request("POST", { journal, expectedVersion }) as { journal: BulkPaymentJournal };
  return data.journal;
}

export async function clearBulkJournal(): Promise<void> {
  await request("DELETE");
}
