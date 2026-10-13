import { beforeEach, expect, it, vi } from "vitest";

const { cache, dbDelete } = vi.hoisted(() => ({
  cache: { get: vi.fn(() => []), set: vi.fn(), reload: vi.fn(), isLoaded: vi.fn(() => false) },
  dbDelete: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: () => [0, vi.fn()] }));
vi.mock("@/lib/db-client", () => ({ createDbCache: () => cache, dbDelete, dbPost: vi.fn(), dbPatch: vi.fn(), debounce: vi.fn() }));
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { usePersons } from "@/hooks/use-persons";

beforeEach(() => { vi.clearAllMocks(); dbDelete.mockRejectedValue(new Error("403")); });
it("rolls back group and member optimistic deletions when rejected", async () => {
  const hooks = useAssetGroups();
  hooks.deleteGroup("group");
  hooks.removeMember("group", "member");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(dbDelete).toHaveBeenCalledWith("/api/db/groups", "group", "group");
  expect(dbDelete).toHaveBeenCalledWith("/api/db/groups", "member", "member");
  expect(cache.reload).toHaveBeenCalledTimes(2);
});
it("rolls back person, address and relationship optimistic deletions when rejected", async () => {
  const hooks = usePersons();
  hooks.deletePerson("person");
  hooks.removePersonAddress("person", "address");
  hooks.deleteRelationship("relationship");
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const type of ["person", "address", "relationship"]) {
    expect(dbDelete).toHaveBeenCalledWith("/api/db/persons", type, type);
  }
  expect(cache.reload).toHaveBeenCalledTimes(3);
});
