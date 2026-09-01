import { describe, expect, it } from "vitest";
import { computeSplit } from "../../utils/computeSplit";
import type { SplitRule, Payment } from "@shopping-list/api/domain";

/**
 * A Payment as it arrives from the working copy: `createdAt`/`updatedAt` are
 * system-managed timestamps (the database defaults createdAt to now and bumps
 * updatedAt on every write), so fixtures never hardcode them — they are
 * generated with the Date API. `paidAt` is the business date the Member
 * records; defaulting it to now mirrors the normal flow of recording a payment
 * the day it happens.
 */
function payment(id: string, memberId: string, amountInCents: number): Payment {
  return {
    id,
    listId: "list-1",
    memberId,
    amountInCents,
    paidAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("computeSplit", () => {
  it("spreads the remainder one cent at a time so shares sum exactly to the total", () => {
    const result = computeSplit("equal", ["a", "b", "c"], [payment("p1", "a", 100)]);

    expect(result.totalInCents).toBe(100);
    expect(result.shares).toEqual([
      { memberId: "a", shareInCents: 34 },
      { memberId: "b", shareInCents: 33 },
      { memberId: "c", shareInCents: 33 },
    ]);
    expect(result.shares.reduce((sum, s) => sum + s.shareInCents, 0)).toBe(100);
  });

  it("keys every share to its Member, so the split reads back by Member not by position", () => {
    const result = computeSplit("equal", ["a", "b", "c"], [payment("p1", "a", 100)]);

    expect(result.shares.map((s) => s.memberId)).toEqual(["a", "b", "c"]);
    expect(result.shares[0]).toMatchObject({ memberId: "a", shareInCents: 34 });
  });

  it("yields no shares for fewer than two Members — a lone Member sees only the total", () => {
    const result = computeSplit("equal", ["a"], [payment("p1", "a", 1400)]);

    expect(result.totalInCents).toBe(1400);
    expect(result.shares).toEqual([]);
  });

  it("keeps a departed Member's payment in the pot and re-divides over the remaining Members", () => {
    const result = computeSplit("equal", ["a", "b"], [
      payment("p1", "a", 300),
      payment("p2", "c", 100),
    ]);

    expect(result.totalInCents).toBe(400);
    expect(result.shares).toEqual([
      { memberId: "a", shareInCents: 200 },
      { memberId: "b", shareInCents: 200 },
    ]);
  });

  it("rejects a split rule the calculation cannot honour instead of dividing wrongly", () => {
    const rule = "weighted" as SplitRule;

    expect(() => computeSplit(rule, ["a", "b"], [])).toThrow("split rule not implemented: weighted");
  });
});