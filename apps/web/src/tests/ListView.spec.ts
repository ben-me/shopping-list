import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List } from "@shopping-list/api/domain";
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
    expect(wrapper.find('[data-testid="item-name"]').text()).toContain("Milk");
  });

  it("adds an Item and it appears immediately, even when the server is unreachable", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('[data-testid="item-name-input"]').setValue("Bread");
    await wrapper.find('[data-testid="add-item"]').trigger("submit");
    await flushPromises();
    await settle();
    await settle();

    const names = wrapper.findAll('[data-testid="item-name"]').map((n) => n.text());
    expect(names).toContain("Bread");
    expect((await db.getItems(list.id)).map((i) => i.name)).toEqual(["Bread"]);
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("ticks an Item off and the tick is still there after a reload", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('[data-testid="item-name-input"]').setValue("Milk");
    await wrapper.find('[data-testid="add-item"]').trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find('[data-testid="item-checkbox"]').setValue();
    await flushPromises();
    await settle();

    // Simulate a reload: a fresh mount reads the same local Store.
    const remounted = await mountList();
    await flushPromises();
    await settle();

    expect((remounted.find('[data-testid="item-checkbox"]').element as HTMLInputElement).checked).toBe(true);
    const stored = (await db.getItems(list.id))[0];
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({ name: "Milk", checked: true });
    expect(stored?.checkedAt).toBeTruthy();
  });

  it("un-ticks a ticked Item back to unchecked", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('[data-testid="item-name-input"]').setValue("Milk");
    await wrapper.find('[data-testid="add-item"]').trigger("submit");
    await flushPromises();
    await settle();

    const checkbox = () => wrapper.find('[data-testid="item-checkbox"]');
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
    await wrapper.find('[data-testid="item-name-input"]').setValue("Milk");
    await wrapper.find('[data-testid="add-item"]').trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find('[data-testid="remove-item"]').trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.findAll('[data-testid="item-name"]')).toHaveLength(0);
    expect(await db.getItems(list.id)).toHaveLength(0);
  });

  it("queues a tick for Sync without creating anything money-related", async () => {
    stubRoutes(() => new Response(null, { status: 503 }));

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('[data-testid="item-name-input"]').setValue("Milk");
    await wrapper.find('[data-testid="add-item"]').trigger("submit");
    await flushPromises();
    await settle();
    await wrapper.find('[data-testid="item-checkbox"]').setValue();
    await flushPromises();
    await settle();

    const pending = await db.pendingOutboxEntries();
    expect(pending.map((e) => e.targetType)).toEqual(["item", "item"]);
    expect(await db.getPayments(list.id)).toHaveLength(0);
  });
});
