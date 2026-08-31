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

describe("computeSplit", () => {
  it("spreads the remainder one cent at a time so shares sum exactly to the total", () => {
    const result = computeSplit(["a", "b", "c"], [payment("p1", "a", 100)]);

    expect(result.totalInCents).toBe(100);
    expect(result.sharesInCents).toEqual([34, 33, 33]);
    expect(result.sharesInCents.reduce((sum, s) => sum + s, 0)).toBe(100);
  });

  it("yields no shares for fewer than two Members — a lone Member sees only the total", () => {
    const result = computeSplit(["a"], [payment("p1", "a", 1400)]);

    expect(result.totalInCents).toBe(1400);
    expect(result.sharesInCents).toEqual([]);
  });

  it("keeps a departed Member's payment in the pot and re-divides over the remaining Members", () => {
    const result = computeSplit(["a", "b"], [payment("p1", "a", 300), payment("p2", "c", 100)]);

    expect(result.totalInCents).toBe(400);
    expect(result.sharesInCents).toEqual([200, 200]);
  });
});
