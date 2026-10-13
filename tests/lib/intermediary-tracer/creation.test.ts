import { afterEach, expect, it, vi } from "vitest";
import { fetchAccountCreation } from "@/lib/intermediary-tracer/fetchers";

vi.mock("@/lib/horizon-fetch", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/horizon-fetch")>(), fetchJson: vi.fn() }));
import { fetchJson, HorizonFetchError } from "@/lib/horizon-fetch";
afterEach(() => vi.resetAllMocks());

it("propagates failed creation lookup rather than reporting no origin", async () => {
  vi.mocked(fetchJson).mockRejectedValue(new Error("Horizon unavailable"));
  await expect(fetchAccountCreation("https://horizon.example", "GA", new AbortController().signal)).rejects.toThrow("Horizon unavailable");
});
it("returns no creation only after successful empty history responses", async () => {
  vi.mocked(fetchJson).mockResolvedValue({ _embedded: { records: [] } });
  expect(await fetchAccountCreation("https://horizon.example", "GA", new AbortController().signal)).toBeNull();
  expect(fetchJson).toHaveBeenCalledTimes(3);
});

it("preserves genuine missing-account results", async () => {
  vi.mocked(fetchJson).mockRejectedValue(new HorizonFetchError(404, "https://horizon.example"));
  expect(await fetchAccountCreation("https://horizon.example", "GA", new AbortController().signal)).toBeNull();
});
