import { computeOwed } from "../../utils/computeOwed";
import type { Payment } from "@shopping-list/api/domain";

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
    const result = computeOwed(["a", "b"], [payment("p1", "a", 300), payment("p2", "b", 100)]);

    expect(result).toEqual([
      { memberId: "a", amountInCents: -100 },
      { memberId: "b", amountInCents: 100 },
    ]);
  });

  it("spreads the remainder one cent at a time so the group settles exactly", () => {
    const result = computeOwed(["a", "b", "c"], [payment("p1", "a", 100)]);

    expect(result).toEqual([
      { memberId: "a", amountInCents: -66 },
      { memberId: "b", amountInCents: 33 },
      { memberId: "c", amountInCents: 33 },
    ]);
    expect(result.reduce((sum, o) => sum + o.amountInCents, 0)).toBe(0);
  });

  it("shows nothing for a lone Member — only the total is visible, never an Owed figure", () => {
    const result = computeOwed(["a"], [payment("p1", "a", 1400)]);

    expect(result).toEqual([]);
  });

  it("keeps a departed Member's payment in the pot and re-divides over the remaining Members", () => {
    const result = computeOwed(["a", "b"], [payment("p1", "a", 300), payment("p2", "c", 100)]);

    expect(result).toEqual([
      { memberId: "a", amountInCents: -100 },
      { memberId: "b", amountInCents: 200 },
    ]);
  });

  it("leaves a zero balance for a Member who paid exactly their share", () => {
    const result = computeOwed(["a", "b"], [payment("p1", "a", 100), payment("p2", "b", 100)]);

    expect(result).toEqual([
      { memberId: "a", amountInCents: 0 },
      { memberId: "b", amountInCents: 0 },
    ]);
  });
});
