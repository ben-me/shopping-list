import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { flushPromises } from "@vue/test-utils";
import type { List } from "@shopping-list/api/domain";
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

/** The screen runs entirely off the local Store, so the server is out of reach. */
function stubOfflineServer() {
  stubApi({}, { user, fallback: serverDown });
}

async function mountList() {
  const { wrapper } = await mountApp(`/list/${list.id}`);
  return wrapper;
}

beforeEach(async () => {
  await resetStore([list]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    stubOfflineServer();

    const wrapper = await mountList();
    await flushPromises();
    await settle();

    expect(wrapper.text()).toContain("Household");
    expect(wrapper.find("label span:last-child").text()).toContain("Milk");
  });

  it("adds an Item and it appears immediately, even when the server is unreachable", async () => {
    stubOfflineServer();

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Bread");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();
    await settle();

    const names = wrapper.findAll("label span:last-child").map((n) => n.text());
    expect(names).toContain("Bread");
    expect((await db.getItems(list.id)).map((i) => i.name)).toEqual(["Bread"]);
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("ticks an Item off and the tick is still there after a reload", async () => {
    stubOfflineServer();

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
    stubOfflineServer();

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

  it("puts the tick back when the local write fails", async () => {
    stubOfflineServer();

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "setItemChecked").mockRejectedValue(new Error("storage is full"));

    const checkbox = () => wrapper.find('input[type="checkbox"]');
    await checkbox().setValue();
    await flushPromises();
    await settle();

    expect((checkbox().element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find("li").classes()).not.toContain("done");
  });

  it("removes an Item from the List", async () => {
    stubOfflineServer();

    const wrapper = await mountList();
    await flushPromises();
    await wrapper.find('input[name="item"]').setValue("Milk");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await settle();

    await wrapper.find("li button").trigger("click");
    await flushPromises();
    await settle();

    expect(wrapper.findAll("label span:last-child")).toHaveLength(0);
    expect(await db.getItems(list.id)).toHaveLength(0);
  });
});
