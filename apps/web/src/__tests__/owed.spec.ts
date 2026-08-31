import { describe, expect, it } from "vitest";
import { computeSplit } from "../owed";
import type { Payment } from "@shopping-list/api/domain";

function payment(id: string, memberId: string, amountInCents: number): Payment {
  return {
    id,
    listId: "list-1",
    memberId,
    amountInCents,
    paidAt: "2026-08-26T00:00:00.000Z",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

describe("computeSplit (equal)", () => {
  it("splits in exact cents, spreading the remainder one cent at a time so shares sum to the total", () => {
    const total = 100;
    const members = ["a", "b", "c"];
    const payments = [payment("p1", "a", 100)];

    const result = computeSplit("equal", members, payments);

    expect(result.totalInCents).toBe(total);
    expect(result.members.map((m) => m.shareInCents)).toEqual([34, 33, 33]);
    expect(result.members.reduce((sum, m) => sum + m.shareInCents, 0)).toBe(total);
    expect(result.members.map((m) => m.owedInCents)).toEqual([-66, 33, 33]);
    expect(result.members.reduce((sum, m) => sum + m.owedInCents, 0)).toBe(0);
  });

  it("uses the sign convention: positive owes the group (red), negative is owed by it (green)", () => {
    const members = ["a", "b"];
    const payments = [payment("p1", "a", 100)];

    const result = computeSplit("equal", members, payments);

    // share = 50 each; a overpaid (group owes a → green, negative),
    // b underpaid (b owes the group → red, positive)
    expect(result.members.find((m) => m.memberId === "a")?.owedInCents).toBe(-50);
    expect(result.members.find((m) => m.memberId === "b")?.owedInCents).toBe(50);
  });

  it("reports the alone case: only the total shows, no Owed figure", () => {
    const result = computeSplit("equal", ["a"], [payment("p1", "a", 1400)]);

    expect(result.totalInCents).toBe(1400);
    expect(result.alone).toBe(true);
    expect(result.members).toEqual([]);
  });

  it("does not recalculate or forgive a leaving Member's payments; the remaining re-divide over the Members who remain", () => {
    // c left the household; c's 100 stays in the pot, but only a and b split now
    const members = ["a", "b"];
    const payments = [payment("p1", "a", 300), payment("p2", "c", 100)];

    const result = computeSplit("equal", members, payments);

    expect(result.totalInCents).toBe(400);
    expect(result.alone).toBe(false);
    expect(result.members).toHaveLength(2);
    expect(result.members.map((m) => m.shareInCents)).toEqual([200, 200]);
    // a paid 300 against a 200 share → group owes a 100; b paid 0 against a
    // 200 share → b owes the group 200 (c's leftover 100 is split in both shares)
    expect(result.members.map((m) => m.owedInCents)).toEqual([-100, 200]);
  });

  it("settles to zero Owed when everyone paid exactly their share", () => {
    const members = ["a", "b"];
    const payments = [payment("p1", "a", 500), payment("p2", "b", 500)];

    const result = computeSplit("equal", members, payments);

    expect(result.totalInCents).toBe(1000);
    expect(result.members.map((m) => m.owedInCents)).toEqual([0, 0]);
  });
});
