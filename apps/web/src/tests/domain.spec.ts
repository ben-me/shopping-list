import { describe, expect, it } from "vitest";
import type { Item, List, Membership, Owed, Payment } from "@shopping-list/api/domain";

describe("shared domain data contract", () => {
  it("a List carries its own split rule and its Owner", () => {
    const list: List = {
      id: "list-1",
      ownerId: "user-1",
      name: "Household",
      splitRule: "equal",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };

    expect(list.splitRule).toBe("equal");
    expect(list.ownerId).toBe("user-1");
  });

  it("an Item ticks off independently of any Payment", () => {
    const item: Item = {
      id: "item-1",
      listId: "list-1",
      name: "Milk",
      checked: true,
      checkedAt: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };

    expect(item.checked).toBe(true);
  });

  it("a Payment is a free-standing dated amount in minor units", () => {
    const payment: Payment = {
      id: "pay-1",
      listId: "list-1",
      memberId: "user-1",
      amountInCents: 1250,
      paidAt: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };

    expect(payment.amountInCents).toBe(1250);
    expect(payment.listId).toBe("list-1");
  });

  it("a Membership ties an existing user to a List; the Owner is also a Member", () => {
    const membership: Membership = {
      listId: "list-1",
      memberId: "user-1",
      joinedAt: "2026-08-26T00:00:00.000Z",
    };

    expect(membership.memberId).toBe("user-1");
    expect(membership.listId).toBe("list-1");
  });

  it("Owed is a net position: positive owes the group, negative is owed by it", () => {
    const owed: Owed = { memberId: "user-1", amountInCents: -450 };

    expect(owed.amountInCents).toBe(-450);
  });
});
