import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List } from "@shopping-list/api/domain";
import { runSyncPass } from "../connectivity";
import App from "../App.vue";
import { db } from "../db";
import { createAppRouter } from "../router";
import { _resetSession, type SessionUser } from "../session";

const user: SessionUser = { id: "user-1", name: "Test User", email: "[EMAIL]" };

const list: List = {
  id: "list-1",
  ownerId: user.id,
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubRoutes(handler?: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/auth/get-session") {
        return jsonResponse({ user });
      }
      if (handler) {
        return handler(url, init);
      }
      throw new Error(`No stub for ${url}`);
    }),
  );
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

async function mountList() {
  const router = createAppRouter(createMemoryHistory());
  await router.push(`/list/${list.id}`);
  await router.isReady();
  return mount(App, { global: { plugins: [router] } });
}

beforeEach(async () => {
  await db.lists.clear();
  await db.items.clear();
  await db.payments.clear();
  await db.memberships.clear();
  await db.outbox.clear();
  await db.syncList(list);
  _resetSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ListView", () => {
  it("renders the List's Items from the local Store", async () => {
    await db.putItem({
      id: "item-1",
      listId: list.id,
      name: "Milk",
      checked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();

    expect(wrapper.text()).toContain("Household");
    expect(wrapper.find("ul li span").text()).toContain("Milk");
  });

  it("adds an Item and it appears immediately, even when the server is unreachable", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Bread");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();
    await settle();

    const names = wrapper.findAll("ul li span").map((n) => n.text());
    expect(names).toContain("Bread");
    expect((await db.getItems(list.id)).map((i) => i.name)).toEqual(["Bread"]);
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("ticks an Item off and the tick is still there after a reload", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find('input[type="checkbox"]').setValue();
    await flushPromises();
    await settle();

    // Simulate a reload: a fresh mount reads the same local Store.
    const remounted = await mountList();
    await flushPromises();
    await settle();

    expect((remounted.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      true,
    );
    const stored = (await db.getItems(list.id))[0];
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({ name: "Milk", checked: true });
    expect(stored?.checkedAt).toBeTruthy();
  });

  it("un-ticks a ticked Item back to unchecked", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    const checkbox = () => wrapper.find('input[type="checkbox"]');
    await checkbox().setValue();
    await flushPromises();
    await settle();
    await checkbox().setValue(false);
    await flushPromises();
    await settle();

    expect((checkbox().element as HTMLInputElement).checked).toBe(false);
    const stored = (await db.getItems(list.id))[0];
    expect(stored).toBeDefined();
    expect(stored?.checked).toBe(false);
    expect(stored?.checkedAt).toBeUndefined();
  });

  it("removes an Item from the List", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find("li button").trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.findAll("ul li span")).toHaveLength(0);
    expect(await db.getItems(list.id)).toHaveLength(0);
  });

  it("queues a tick for Sync without creating anything money-related", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();
    await wrapper.find('input[type="checkbox"]').setValue();
    await flushPromises();
    await settle();

    const pending = await db.pendingOutboxEntries();
    expect(pending.map((e) => e.targetType)).toEqual(["item", "item"]);
    expect(await db.getPayments(list.id)).toHaveLength(0);
  });

  it("records a Payment with an amount and a date, and it survives a reload", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="payment-amount"]').setValue("12.50");
    await wrapper.find('input[name="payment-date"]').setValue("2026-02-01");
    await wrapper.find("form.payments-form").trigger("submit");
    await flushPromises();
    await settle();

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
    const remounted = await mountList();
    await flushPromises();
    await settle();
    expect(remounted.text()).toContain("12,50");
  });

  it("rejects recording a Payment without a positive amount", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="payment-amount"]').setValue("0");
    await wrapper.find("form.payments-form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Give the payment a positive amount");
    expect(await db.getPayments(list.id)).toHaveLength(0);
  });

  it("edits and deletes your own Payment but offers nothing on another Member's", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));
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

    const wrapper = await mountList();
    await flushPromises();

    const rowByAmount = (amount: string) =>
      wrapper.findAll(".payments li").filter((row) => row.text().includes(amount))[0];
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
    await wrapper.find("form.edit-payment-form").trigger("submit");
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

  it("shows the running total and each Member's share and Owed under the equal Split", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));
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

    const wrapper = await mountList();
    await flushPromises();

    // Running total and the equal share, exactly as computeOwed figures them.
    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 4,00");
    const rows = wrapper.findAll(".standing-member");
    expect(rows).toHaveLength(2);

    const you = rows[0]!;
    expect(you.text()).toContain("You");
    expect(you.text()).toContain("share 2,00");
    expect(you.text()).toContain("is owed 1,00");
    expect(you.classes()).toContain("owed"); // green: the group owes them

    const other = rows[1]!;
    expect(other.text()).toContain("user-2");
    expect(other.text()).toContain("share 2,00");
    expect(other.text()).toContain("owes 1,00");
    expect(other.classes()).toContain("owes"); // red: they owe the group
  });

  it("shows only the running total on a lone-Member List — never a Share or an Owed figure", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));
    await db.putPayment({
      id: "pay-1",
      listId: list.id,
      memberId: user.id,
      amountInCents: 1400,
      paidAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });

    const wrapper = await mountList();
    await flushPromises();

    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 14,00");
    expect(wrapper.findAll(".standing-member")).toHaveLength(0);
    const standing = wrapper.find(".standing").text();
    expect(standing).not.toContain("share");
    expect(standing).not.toContain("owes");
    expect(standing).not.toContain("owed");
  });

  it("recomputes the standing live as a Payment is added, edited, and deleted", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));
    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });

    const wrapper = await mountList();
    await flushPromises();

    const rowText = (index: number) => wrapper.findAll(".standing-member")[index]!.text();

    // Record a Payment: the header re-divides immediately.
    await wrapper.find('input[name="payment-amount"]').setValue("12.50");
    await wrapper.find('input[name="payment-date"]').setValue("2026-02-01");
    await wrapper.find("form.payments-form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 12,50");
    expect(wrapper.findAll(".standing-member")).toHaveLength(2);
    expect(rowText(0)).toContain("share 6,25");
    expect(rowText(0)).toContain("is owed 6,25");
    expect(rowText(1)).toContain("owes 6,25");

    // Edit the Payment down: the figures follow the new amount.
    await wrapper.find('button[name="edit-payment"]').trigger("click");
    await flushPromises();
    await wrapper.find('input[name="edit-amount"]').setValue("9.90");
    await wrapper.find("form.edit-payment-form").trigger("submit");
    await flushPromises();
    await settle();

    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 9,90");
    expect(rowText(0)).toContain("share 4,95");
    expect(rowText(0)).toContain("is owed 4,95");
    expect(rowText(1)).toContain("owes 4,95");

    // Delete it: the two Members settle at zero.
    await wrapper.find('button[name="delete-payment"]').trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 0,00");
    expect(wrapper.findAll(".standing-member")).toHaveLength(2);
    expect(rowText(0)).toContain("settled");
    expect(rowText(1)).toContain("settled");
  });

  it("re-divides the standing when Membership changes arrive on Sync", async () => {
    stubRoutes((url) => {
      if (url === "/api/lists") {
        return jsonResponse({ lists: [] });
      }
      if (url.endsWith("/items")) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/payments")) {
        return jsonResponse({ payments: [] });
      }
      throw new Error(`No stub for ${url}`);
    });
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

    const wrapper = await mountList();
    await flushPromises();
    await settle();

    // Two Members split the pot: You paid it all, the other Member owes half.
    expect(wrapper.findAll(".standing-member")).toHaveLength(2);
    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 12,00");
    expect(wrapper.findAll(".standing-member")[0]!.text()).toContain("is owed 6,00");
    expect(wrapper.findAll(".standing-member")[1]!.text()).toContain("owes 6,00");

    // A third Member joins; the next Sync pass re-divides the same pot.
    await db.syncMembership({
      listId: list.id,
      memberId: "user-3",
      joinedAt: "2026-01-02T00:00:00.000Z",
    });
    await runSyncPass(db);
    await flushPromises();

    const rows = wrapper.findAll(".standing-member");
    expect(rows).toHaveLength(3);
    expect(wrapper.find(".total-paid").text()).toContain("Total paid: 12,00");
    expect(rows[0]!.text()).toContain("is owed 8,00");
    expect(rows[1]!.text()).toContain("owes 4,00");
    expect(rows[2]!.text()).toContain("owes 4,00");
  });
});
