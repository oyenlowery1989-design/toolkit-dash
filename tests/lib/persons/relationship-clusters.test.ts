import { describe, it, expect } from "vitest";
import { computeClusters } from "@/lib/persons/relationship-clusters";
import type { Person } from "@/lib/persons/types";

function makePerson(id: string, name: string, relationships: Person["relationships"] = []): Person {
  return { id, name, addresses: [], relationships, createdAt: 1000, updatedAt: 1000 };
}

describe("computeClusters", () => {
  it("returns no clusters when no one has relationships", () => {
    const persons = [makePerson("p1", "Alice"), makePerson("p2", "Bob")];
    expect(computeClusters(persons)).toEqual([]);
  });

  it("groups two directly-related persons into one cluster", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].personIds.sort()).toEqual(["p1", "p2"]);
    expect(clusters[0].edgeCount).toBe(1);
  });

  it("transitively clusters A-B-C into one cluster even with no direct A-C edge", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [
        { id: "r1", personId: "p1", type: "friend" },
        { id: "r2", personId: "p3", type: "colleague" },
      ]),
      makePerson("p3", "Carol", [{ id: "r2", personId: "p2", type: "colleague" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].personIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(clusters[0].edgeCount).toBe(2);
  });

  it("keeps unrelated pairs as separate clusters", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
      makePerson("p3", "Carol", [{ id: "r2", personId: "p4", type: "invited_by", direction: "invitee" }]),
      makePerson("p4", "Dave", [{ id: "r2", personId: "p3", type: "invited_by", direction: "inviter" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(2);
  });

  it("omits persons with no relationships entirely", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
      makePerson("p3", "Carol"),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].personIds).not.toContain("p3");
  });

  it("sorts larger clusters first", () => {
    const persons = [
      makePerson("p1", "Alice", [{ id: "r1", personId: "p2", type: "friend" }]),
      makePerson("p2", "Bob", [{ id: "r1", personId: "p1", type: "friend" }]),
      makePerson("p3", "Carol", [
        { id: "r2", personId: "p4", type: "colleague" },
        { id: "r3", personId: "p5", type: "colleague" },
      ]),
      makePerson("p4", "Dave", [{ id: "r2", personId: "p3", type: "colleague" }]),
      makePerson("p5", "Eve", [{ id: "r3", personId: "p3", type: "colleague" }]),
    ];
    const clusters = computeClusters(persons);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].personIds).toHaveLength(3);
    expect(clusters[1].personIds).toHaveLength(2);
  });
});
