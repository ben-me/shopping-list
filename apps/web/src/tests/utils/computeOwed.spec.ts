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

    expect(result.owed).toEqual([
      { memberId: "a", amountInCents: -100 },
      { memberId: "b", amountInCents: 100 },
    ]);
    expect(result.totalInCents).toBe(400);
    expect(result.shareInCents).toBe(200);
  });

  it("spreads the remainder one cent at a time so the group settles exactly", () => {
    const result = computeOwed(["a", "b", "c"], [payment("p1", "a", 100)]);

    expect(result.owed).toEqual([
      { memberId: "a", amountInCents: -66 },
      { memberId: "b", amountInCents: 33 },
      { memberId: "c", amountInCents: 33 },
    ]);
    expect(result.totalInCents).toBe(100);
    expect(result.shareInCents).toBe(33);
    expect(result.owed.reduce((sum, o) => sum + o.amountInCents, 0)).toBe(0);
  });

  it("shows only the total for a lone Member — never a share or an Owed figure", () => {
    const result = computeOwed(["a"], [payment("p1", "a", 1400)]);

    expect(result).toEqual({ totalInCents: 1400, shareInCents: null, owed: [] });
  });

  it("keeps a departed Member's payment in the pot and re-divides over the Members who remain", () => {
    const result = computeOwed(["a", "b"], [payment("p1", "a", 300), payment("p2", "c", 100)]);

    expect(result.totalInCents).toBe(400);
    expect(result.shareInCents).toBe(200);
    expect(result.owed).toEqual([
      { memberId: "a", amountInCents: -100 },
      { memberId: "b", amountInCents: 200 },
    ]);
  });

  it("leaves nothing Owed for a Member who paid exactly their share", () => {
    const result = computeOwed(["a", "b"], [payment("p1", "a", 100), payment("p2", "b", 100)]);

    expect(result.owed).toEqual([
      { memberId: "a", amountInCents: 0 },
      { memberId: "b", amountInCents: 0 },
    ]);
  });
});
