import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);
vi.mock("vue-draggable-plus", () => ({ useDraggable: vi.fn<(...args: unknown[]) => void>() }));

import { flushPromises } from "@vue/test-utils";
import { useDraggable } from "vue-draggable-plus";
import type { Item, List } from "@shopping-list/api/domain";
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

function item(id: string, name: string, position: number): Item {
  return {
    id,
    listId: list.id,
    name,
    checked: false,
    position,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface DraggableOptions {
  onUpdate: (event: { data: Item; newDraggableIndex: number }) => void;
}

/** The options ListView handed the composable on this mount. */
function draggableOptions(): DraggableOptions {
  const calls = vi.mocked(useDraggable).mock.calls as unknown as Array<
    [unknown, unknown, DraggableOptions]
  >;
  return calls[calls.length - 1]![2];
}

async function mountList() {
  stubApi({}, { user, fallback: serverDown });
  const { wrapper } = await mountApp(`/list/${list.id}`);
  await flushPromises();
  await settle();
  return wrapper;
}

beforeEach(async () => {
  vi.mocked(useDraggable).mockClear();
  await resetStore([list]);
  await db.putItem(item("item-a", "Apples", 0));
  await db.putItem(item("item-b", "Bread", 1));
  await db.putItem(item("item-c", "Cheese", 2));
  await db.drainOutbox(async () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reordering Items", () => {
  it("persists the move Sortable reports on update", async () => {
    await mountList();

    // What Sortable reports when the last row is dragged to the top.
    draggableOptions().onUpdate({
      data: (await db.getItem("item-c"))!,
      newDraggableIndex: 0,
    });
    await flushPromises();
    await settle();

    const saved = await db.getItems(list.id);
    expect(saved.map((i) => i.name)).toEqual(["Cheese", "Apples", "Bread"]);
    expect(saved[0]!.position).toBeLessThan(saved[1]!.position);
    expect(await db.pendingOutboxEntries()).toMatchObject([
      { targetType: "item", targetId: "item-c", operation: "update" },
    ]);
  });
});
