import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Connection, type Db } from "../db";
import { createList } from "../lists/queries";
import { runMigrations, startMiniflare } from "../test-support";
import * as membersQueries from "./queries";

describe("members query helpers", () => {
  let mf: Miniflare;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-members-queries-db");
    const devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
    db = createD1Connection(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates, reads, and deletes Membership rows", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });
    const membership = await membersQueries.createMembership(db, {
      listId: list.id,
      memberId: "u-buyer",
    });

    expect(membership.joinedAt).toBeTruthy();
    await expect(
      membersQueries.getMembership(db, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toEqual(membership);
    await expect(
      membersQueries.getMembership(db, { listId: list.id, memberId: "u-stranger" }),
    ).resolves.toBeUndefined();

    const members = await membersQueries.getMembershipsByList(db, list.id);
    expect(members.map((m) => m.memberId)).toContain("u-buyer");

    await expect(
      membersQueries.deleteMembership(db, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBe(true);
    await expect(
      membersQueries.getMembership(db, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBeUndefined();
  });

  it("treats the Owner as a Member before any Membership row exists", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });

    await expect(membersQueries.isMember(db, list, "u-owner")).resolves.toBe(true);
  });

  it("admits a Member and rejects an outsider", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });
    await membersQueries.createMembership(db, { listId: list.id, memberId: "u-buyer" });

    await expect(membersQueries.isMember(db, list, "u-buyer")).resolves.toBe(true);
    await expect(membersQueries.isMember(db, list, "u-stranger")).resolves.toBe(false);

    await membersQueries.deleteMembership(db, { listId: list.id, memberId: "u-buyer" });
    await expect(membersQueries.isMember(db, list, "u-buyer")).resolves.toBe(false);
  });
});
