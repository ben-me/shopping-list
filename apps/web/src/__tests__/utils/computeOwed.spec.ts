import { describe, expect, it } from "vitest";
import { computeOwed } from "../../utils/computeOwed";
import type { Payment } from "@shopping-list/api/domain";

/**
 * System-managed timestamps (`createdAt`/`updatedAt`) and the business date
 * (`paidAt`) are generated, never hardcoded — the store/database owns them.
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

describe("computeOwed", () => {
  it("signs the net position: positive owes the group (red), negative is owed by it (green)", () => {
    const result = computeOwed("equal", ["a", "b"], [
      payment("p1", "a", 300),
      payment("p2", "b", 100),
    ]);

    // share is 200 each; a overpaid by 100 (group owes a, green), b underpaid by 100 (b owes, red)
    expect(result).toEqual([
      { memberId: "a", amountInCents: -100 },
      { memberId: "b", amountInCents: 100 },
    ]);
  });

  it("is exact under a remainder: shares and Owed figures always agree with computeSplit", () => {
    const result = computeOwed("equal", ["a", "b", "c"], [payment("p1", "a", 100)]);

    // shares 34/33/33; the pot is fully allocated, so the group nets to zero
    expect(result).toEqual([
      { memberId: "a", amountInCents: -66 },
      { memberId: "b", amountInCents: 33 },
      { memberId: "c", amountInCents: 33 },
    ]);
    expect(result.reduce((sum, o) => sum + o.amountInCents, 0)).toBe(0);
  });

  it("shows nothing for a lone Member — only the total is visible, never an Owed figure", () => {
    const result = computeOwed("equal", ["a"], [payment("p1", "a", 1400)]);

    expect(result).toEqual([]);
  });

  it("re-divides over the remaining Members after one leaves, their payment staying in the pot", () => {
    const result = computeOwed("equal", ["a", "b"], [
      payment("p1", "a", 300),
      payment("p2", "c", 100),
    ]);

    // total 400 over a and b is 200 each; a already paid 300, b paid nothing
    expect(result).toEqual([
      { memberId: "a", amountInCents: -100 },
      { memberId: "b", amountInCents: 200 },
    ]);
  });
});