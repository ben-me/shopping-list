import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List } from "@shopping-list/api/domain";
import { runSyncPass } from "../connectivity";
import { db } from "../db";
import type { SessionUser } from "../session";
import { mountApp, resetStore, serverDown, settle, stubApi } from "./support/app";

const user: SessionUser = { id: "user-1", name: "Test User", email: "[EMAIL]" };

const list: List = {
  id: "list-1",
  ownerId: user.id,
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * The screen reads its figures from the local Store, so most of these tests
 * only need the server to be out of reach.
 */
function stubOfflineServer() {
  stubApi({}, { user, fallback: serverDown });
}

/** A reachable server that names the Members: only a Sync pass can label a row. */
function stubNamedMembers() {
  stubApi(
    {
      "GET /api/lists": { lists: [list] },
      [`GET /api/lists/${list.id}/items`]: { items: [] },
      [`GET /api/lists/${list.id}/payments`]: { payments: [] },
      [`GET /api/lists/${list.id}/members`]: {
        members: [
          { memberId: user.id, name: "Test User", joinedAt: list.createdAt },
          { memberId: "user-2", name: "Two", joinedAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
      // The queued Payment writes drain through the outbox before the pull.
      [`PUT /api/lists/${list.id}/payments/*`]: {},
    },
    { user, fallback: serverDown },
  );
}

async function mountList() {
  const { wrapper } = await mountApp(`/list/${list.id}`);
  return wrapper;
}

async function mountPayments() {
  const { wrapper } = await mountApp(`/list/${list.id}/payments`);
  return wrapper;
}

async function recordPayment(amount: string, date: string) {
  const wrapper = await mountPayments();
  await flushPromises();
  await wrapper.find('input[name="payment-amount"]').setValue(amount);
  await wrapper.find('input[name="payment-date"]').setValue(date);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
  await settle();
  return wrapper;
}

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaymentsView", () => {
  it("keeps the List's name painted when switching between Items and Payments", async () => {
    stubOfflineServer();

    const items = await mountList();
    await flushPromises();
    expect(items.find("h1").text()).toBe("Household");
    items.unmount();

    // Mounting is enough: the name is already there, so the app bar does not
    // flash an empty title while the Store read is in flight.
    const payments = await mountPayments();
    expect(payments.find("h1").text()).toBe("Household");
  });

  it("hangs off the List's navigation rather than living under the Items", async () => {
    stubOfflineServer();
    const wrapper = await mountList();
    await flushPromises();

    const paymentsTab = wrapper.find('a[href="/list/list-1/payments"]');
    expect(paymentsTab.text()).toBe("Payments");

    // The Payments screen is not rendered on the Items screen at all.
    expect(wrapper.find('input[name="payment-amount"]').exists()).toBe(false);
    expect(wrapper.find(".total-paid").exists()).toBe(false);
  });

  it("records a Payment with an amount and a date, and it survives a reload", async () => {
    stubOfflineServer();

    const wrapper = await recordPayment("12.50", "2026-02-01");

    expect(wrapper.text()).toContain("12,50");
    const stored = await db.getPayments(list.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      listId: list.id,
      memberId: user.id,
      amountInCents: 1250,
      paidAt: expect.stringContaining("2026-02-01"),
    });
    expect((await db.pendingOutboxEntries()).map((e) => e.targetType)).toEqual(["payment"]);

    // A fresh mount reads the same local Store — the Payment survived.
    const remounted = await mountPayments();
    await flushPromises();
    await settle();
    expect(remounted.text()).toContain("12,50");
  });

  it("rejects recording a Payment without a positive amount", async () => {
    stubOfflineServer();

    const wrapper = await recordPayment("0", "2026-02-01");

    expect(wrapper.text()).toContain("Give the payment a positive amount");
    expect(await db.getPayments(list.id)).toHaveLength(0);
  });

  it("edits and deletes your own Payment but offers nothing on another Member's", async () => {
    stubOfflineServer();
    await db.putPayment({
      id: "pay-mine",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-02-01T10:00:00.000Z",
    });
    await db.putPayment({
      id: "pay-theirs",
      listId: list.id,
      memberId: "user-2",
      amountInCents: 700,
      paidAt: "2026-02-02T10:00:00.000Z",
      createdAt: "2026-02-02T09:00:00.000Z",
      updatedAt: "2026-02-02T10:00:00.000Z",
    });

    const wrapper = await mountPayments();
    await flushPromises();

    const rowByAmount = (amount: string) =>
      wrapper.findAll("ul li").filter((row) => row.text().includes(amount))[0];
    const mine = rowByAmount("12,50");
    const theirs = rowByAmount("7,0");
    expect(mine).toBeDefined();
    expect(theirs).toBeDefined();

    // My Payment offers edit and delete; theirs offers neither.
    expect(mine!.find('button[name="edit-payment"]').exists()).toBe(true);
    expect(mine!.find('button[name="delete-payment"]').exists()).toBe(true);
    expect(theirs!.find('button[name="edit-payment"]').exists()).toBe(false);
    expect(theirs!.find('button[name="delete-payment"]').exists()).toBe(false);

    // Editing my Payment updates the amount and the date.
    await mine!.find('button[name="edit-payment"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[name="edit-amount"]').setValue("9.90");
    await wrapper.find('input[name="edit-date"]').setValue("2026-02-03");
    await wrapper.find('form[aria-label="Edit payment"]').trigger("submit");
    await flushPromises();
    await settle();

    const storedMine = (await db.getPayments(list.id)).find((p) => p.id === "pay-mine");
    expect(storedMine).toMatchObject({
      amountInCents: 990,
      paidAt: expect.stringContaining("2026-02-03"),
    });

    // Deleting my Payment removes it; theirs remains.
    await mine!.find('button[name="delete-payment"]').trigger("click");
    await flushPromises();
    await settle();

    const remaining = await db.getPayments(list.id);
    expect(remaining.map((p) => p.id)).toEqual(["pay-theirs"]);
  });

  it("keeps the running total in the foot of the screen", async () => {
    stubOfflineServer();
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-02-01T10:00:00.000Z",
    });

    const wrapper = await mountPayments();
    await flushPromises();

    expect(wrapper.find("footer .total-paid").text()).toContain("12,50");
  });

  it("names the Member who paid on every row of the ledger", async () => {
    stubNamedMembers();
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1250,
      paidAt: "2026-02-01T10:00:00.000Z",
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-02-01T10:00:00.000Z",
    });
    await db.putPayment({
      id: "pay-2",
      listId: list.id,
      memberId: "user-2",
      amountInCents: 700,
      paidAt: "2026-02-02T10:00:00.000Z",
      createdAt: "2026-02-02T09:00:00.000Z",
      updatedAt: "2026-02-02T10:00:00.000Z",
    });

    const wrapper = await mountPayments();
    await flushPromises();
    // Names are server-only: the mount's Sync pass is what labels the rows.
    await runSyncPass(db);
    await flushPromises();

    const rowByAmount = (amount: string) =>
      wrapper.findAll("ul li").filter((row) => row.text().includes(amount))[0]!;
    // Your own Payment reads "You"; another Member's carries their name.
    expect(rowByAmount("12,50").find("span").text()).toBe("You");
    expect(rowByAmount("7,00").find("span").text()).toBe("Two");
    expect(rowByAmount("7,00").text()).not.toContain("user-2");
  });

  it("keeps your own net in the foot of the screen, under the running total", async () => {
    stubNamedMembers();
    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 300,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });
    await db.putPayment({
      id: "pay-2",
      listId: list.id,
      memberId: "user-2",
      amountInCents: 100,
      paidAt: "2026-01-02T10:00:00.000Z",
      createdAt: "2026-01-02T09:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    });

    const wrapper = await mountPayments();
    await flushPromises();
    // Names are server-only: the mount's Sync pass is what labels the rows.
    await runSyncPass(db);
    await flushPromises();

    // Running total and your own net, exactly as computeOwed figures them.
    expect(wrapper.find(".total-paid").text()).toContain("4,00");
    const own = wrapper.find(".own-standing");
    expect(own.text()).toContain("You are owed");
    expect(own.text()).toContain("1,00");
    expect(own.classes()).toContain("owed"); // green: the group owes you

    // The per-Member table lives on the Members panel, not here.
    expect(wrapper.find(".standing-member").exists()).toBe(false);
  });

  it("shows only the running total on a lone-Member List — never a Share or an Owed figure", async () => {
    stubOfflineServer();
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1400,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });

    const wrapper = await mountPayments();
    await flushPromises();

    expect(wrapper.find(".total-paid").text()).toContain("14,00");
    expect(wrapper.find(".own-standing").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("share");
    expect(wrapper.text()).not.toContain("owes");
    expect(wrapper.text()).not.toContain("owed");
  });

  it("recomputes your own net live as a Payment is added, edited, and deleted", async () => {
    stubOfflineServer();
    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });

    const wrapper = await recordPayment("12.50", "2026-02-01");

    // Record a Payment: your net re-divides immediately.
    expect(wrapper.find(".total-paid").text()).toContain("12,50");
    expect(wrapper.find(".own-standing").text()).toContain("You are owed");
    expect(wrapper.find(".own-standing").text()).toContain("6,25");

    // Edit the Payment down: the figures follow the new amount.
    await wrapper.find('button[name="edit-payment"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[name="edit-amount"]').setValue("9.90");
    await wrapper.find('form[aria-label="Edit payment"]').trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.find(".total-paid").text()).toContain("9,90");
    expect(wrapper.find(".own-standing").text()).toContain("You are owed");
    expect(wrapper.find(".own-standing").text()).toContain("4,95");

    // Delete it: the two Members settle at zero.
    await wrapper.find('button[name="delete-payment"]').trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.find(".total-paid").text()).toContain("0,00");
    expect(wrapper.find(".own-standing").text()).toContain("Settled up");
  });

  it("re-divides your own net when Membership changes arrive on Sync", async () => {
    stubApi(
      {
        // The server still returns the List (Sync prunes local Lists the
        // server no longer returns); only Memberships and Payments change.
        "GET /api/lists": { lists: [list] },
        [`GET /api/lists/${list.id}/items`]: { items: [] },
        [`GET /api/lists/${list.id}/payments`]: { payments: [] },
        [`PUT /api/lists/${list.id}/payments/*`]: {},
      },
      { user, fallback: serverDown },
    );
    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.syncPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1200,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });

    const wrapper = await mountPayments();
    await flushPromises();
    await settle();

    // Two Members split the pot: You paid it all, so the group owes you half.
    expect(wrapper.find(".total-paid").text()).toContain("12,00");
    expect(wrapper.find(".own-standing").text()).toContain("You are owed");
    expect(wrapper.find(".own-standing").text()).toContain("6,00");

    // A third Member joins; the next Sync pass re-divides the same pot.
    await db.syncMembership({
      listId: list.id,
      memberId: "user-3",
      joinedAt: "2026-01-02T00:00:00.000Z",
    });
    await runSyncPass(db);
    await flushPromises();

    expect(wrapper.find(".total-paid").text()).toContain("12,00");
    expect(wrapper.find(".own-standing").text()).toContain("You are owed");
    expect(wrapper.find(".own-standing").text()).toContain("8,00");
  });
});
