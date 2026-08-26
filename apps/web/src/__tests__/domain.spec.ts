import { describe, expect, it } from "vitest";

// Imported straight from the api package — the web app shares these shapes from
// the single source of truth rather than redefining them.
import type { Item, List, Owed, Payment } from "@shopping-list/api";

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
      amountMinor: 1250, // €12.50
      paidAt: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };

    expect(payment.amountMinor).toBe(1250);
    expect(payment.listId).toBe("list-1");
  });

  it("Owed is a net position: positive owes the group, negative is owed by it", () => {
    const owed: Owed = { memberId: "user-1", amountMinor: -450 };

    expect(owed.amountMinor).toBe(-450);
  });
});
