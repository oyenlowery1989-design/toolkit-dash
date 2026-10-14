import { beforeEach, expect, it, vi } from "vitest";

const { cache, dbPost, dbDelete } = vi.hoisted(() => ({
  cache: { get: vi.fn((): unknown[] => []), set: vi.fn(), reload: vi.fn(), isLoaded: vi.fn(() => true) },
  dbPost: vi.fn(),
  dbDelete: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: () => [0, vi.fn()] }));
vi.mock("@/lib/db-client", () => ({ createDbCache: () => cache, dbPost, dbDelete, dbPatch: vi.fn(), debounce: vi.fn() }));
import { useWalletsV2 } from "@/hooks/use-wallets-v2";

beforeEach(() => {
  vi.clearAllMocks();
  cache.get.mockReturnValue([]);
  cache.reload.mockResolvedValue(undefined);
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { setItem: () => { throw new Error("disabled"); } });
});

it("reports a rejected wallet save and reloads the optimistic cache", async () => {
  dbPost.mockRejectedValue(new Error("database unavailable"));
  const { addWallet } = useWalletsV2();
  await expect(addWallet("folder", "Wallet", "public", "secret")).rejects.toThrow("database unavailable");
  expect(dbPost).toHaveBeenCalledOnce();
  expect(cache.reload).toHaveBeenCalledWith("/api/db/wallets-v2");
});

it("saves a wallet even when browser storage is disabled", async () => {
  dbPost.mockResolvedValue({});
  const { addWallet } = useWalletsV2();
  await expect(addWallet("folder", "Wallet", "public", "secret")).resolves.toBeTypeOf("string");
  expect(dbPost).toHaveBeenCalledOnce();
});

it("reports wallet deletion failure so the UI cannot claim success", async () => {
  dbDelete.mockRejectedValue(new Error("database unavailable"));
  const { removeWallet } = useWalletsV2();
  await expect(removeWallet("wallet-id")).rejects.toThrow("database unavailable");
  expect(cache.reload).toHaveBeenCalledWith("/api/db/wallets-v2");
});
