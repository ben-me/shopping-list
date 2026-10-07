import "fake-indexeddb/auto";

import { effectScope, ref } from "vue";
import type { List } from "@shopping-list/api/domain";
import { useLiveMembers } from "../composables/useLiveMembers";
import { db } from "../db";
import { settle } from "./support/app";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Mount the hook in its own scope, the way a screen's setup does. */
function mountLiveMembers(listId = ref(list.id)) {
  const scope = effectScope();
  const members = scope.run(() => useLiveMembers(listId))!;
  return { members, listId, stop: () => scope.stop() };
}

beforeEach(async () => {
  await db.clearAll();
  await db.syncList(list);
});

describe("useLiveMembers", () => {
  it("fills in from the local database, Owner first, with the names last Sync pulled", async () => {
    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-02T00:00:00.000Z",
    });
    await db.putMemberNames([
      { memberId: "user-1", name: "Test User" },
      { memberId: "user-2", name: "Ada" },
    ]);
    const { members, stop } = mountLiveMembers();

    await settle();

    expect(members.value.map((row) => row.memberId)).toEqual(["user-1", "user-2"]);
    expect(members.value.map((row) => row.name)).toEqual(["Test User", "Ada"]);
    stop();
  });

  it("names a Member the Store holds no name for, rather than dropping the row", async () => {
    const { members, stop } = mountLiveMembers();

    await settle();

    expect(members.value).toEqual([
      { memberId: "user-1", name: "Member", joinedAt: list.createdAt },
    ]);
    stop();
  });

  it("redraws on a Membership write, with no read of the List afterwards", async () => {
    const { members, stop } = mountLiveMembers();
    await settle();
    expect(members.value).toHaveLength(1);

    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-02T00:00:00.000Z",
    });
    await settle();

    expect(members.value.map((row) => row.memberId)).toEqual(["user-1", "user-2"]);
    stop();
  });

  it("redraws on a name write the app did not make, such as a pull that named a Member", async () => {
    const { members, stop } = mountLiveMembers();
    await settle();

    await db.putMemberNames([{ memberId: "user-1", name: "Test User" }]);
    await settle();

    expect(members.value[0]?.name).toBe("Test User");
    stop();
  });

  it("switches to another List's Members, never showing the old List's", async () => {
    await db.syncList({ ...list, id: "list-2", ownerId: "user-3" });
    await db.syncMembership({
      listId: "list-2",
      memberId: "user-4",
      joinedAt: "2026-01-03T00:00:00.000Z",
    });
    await db.putMemberNames([
      { memberId: "user-1", name: "Test User" },
      { memberId: "user-3", name: "Three" },
      { memberId: "user-4", name: "Four" },
    ]);
    const { members, listId, stop } = mountLiveMembers();
    await settle();
    expect(members.value.map((row) => row.memberId)).toEqual(["user-1"]);

    listId.value = "list-2";
    await settle();

    expect(members.value.map((row) => row.memberId)).toEqual(["user-3", "user-4"]);
    stop();
  });

  it("stops following the database once the screen is gone", async () => {
    const { members, stop } = mountLiveMembers();
    await settle();
    stop();

    await db.syncMembership({
      listId: list.id,
      memberId: "user-2",
      joinedAt: "2026-01-02T00:00:00.000Z",
    });
    await settle();

    expect(members.value).toHaveLength(1);
  });
});
