import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Connection, type Db } from "../db";
import { createMembership } from "../members/queries";
import { runMigrations, startMiniflare } from "../test-support";
import * as listsQueries from "./queries";

describe("lists query helpers", () => {
  let mf: Miniflare;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-lists-queries-db");
    const devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
    db = createD1Connection(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates and reads back a List with domain typing", async () => {
    const list = await listsQueries.createList(db, { ownerId: "u-owner", name: "Weekly shop" });

    expect(list.id).toBeTruthy();
    expect(list.name).toBe("Weekly shop");
    expect(list.ownerId).toBe("u-owner");
    expect(list.createdAt).toBeTruthy();
    expect(list.updatedAt).toBeTruthy();

    await expect(listsQueries.getList(db, list.id)).resolves.toEqual(list);
    await expect(listsQueries.getList(db, "missing")).resolves.toBeUndefined();
  });

  it("lists the Lists a user owns or has joined", async () => {
    const ownerList = await listsQueries.createList(db, { ownerId: "u-alice", name: "Owned" });
    const joinedList = await listsQueries.createList(db, { ownerId: "u-bob", name: "Joined" });
    await createMembership(db, { listId: joinedList.id, memberId: "u-alice" });

    const aliceIds = (await listsQueries.getListsForMember(db, "u-alice")).map((l) => l.id);

    expect(aliceIds).toContain(ownerList.id);
    expect(aliceIds).toContain(joinedList.id);

    const bobIds = (await listsQueries.getListsForMember(db, "u-bob")).map((l) => l.id);
    expect(bobIds).toContain(joinedList.id);
    expect(bobIds).not.toContain(ownerList.id);
  });

  it("updates and deletes a List", async () => {
    const list = await listsQueries.createList(db, { ownerId: "u-owner", name: "Before" });

    const updated = await listsQueries.updateList(db, list.id, { name: "After" });
    expect(updated?.name).toBe("After");

    await expect(listsQueries.deleteList(db, list.id)).resolves.toBe(true);
    await expect(listsQueries.getList(db, list.id)).resolves.toBeUndefined();
    await expect(listsQueries.deleteList(db, list.id)).resolves.toBe(false);
  });
});
