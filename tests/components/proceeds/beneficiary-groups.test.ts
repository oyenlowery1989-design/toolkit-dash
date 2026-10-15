import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { BeneficiaryGroups } from "@/components/shared/proceeds/BeneficiaryGroups";
vi.mock("@/components/shared/ShortAddress", () => ({ ShortAddress: () => null }));
beforeEach(() => vi.stubGlobal("React", React));
it("shows unknown legacy metadata and cautious interpretation without claiming exchange identity", () => {
  const html = renderToStaticMarkup(React.createElement(BeneficiaryGroups, { groupings: [undefined, { network: "public", groups: [], unresolvedOperationCount: 2 }], historyIncomplete: true }));
  expect(html).toContain("Possible common credit destination");
  expect(html).toContain("does not prove sender identity or common ownership");
  expect(html).toContain("Exchange/service identity is unverified");
  expect(html).toContain("1 snapshot(s) have no memo grouping metadata");
  expect(html).toContain("2 unresolved memo or recipient record(s)");
  expect(html).toContain("History is incomplete");
  expect(html).toContain('aria-expanded="false"');
});
