import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Connection, type Db } from "./db";
import * as queries from "./queries";
import { runMigrations, startMiniflare } from "./test-support";

describe("typed query helpers across the domain tables", () => {
  let mf: Miniflare;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-queries-db");
    const devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
    db = createD1Connection(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates and reads back a List with domain typing", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Weekly shop" });

    expect(list.id).toBeTruthy();
    expect(list.name).toBe("Weekly shop");
    expect(list.ownerId).toBe("u-owner");
    expect(list.createdAt).toBeTruthy();
    expect(list.updatedAt).toBeTruthy();

    await expect(queries.getList(db, list.id)).resolves.toEqual(list);
    await expect(queries.getList(db, "missing")).resolves.toBeUndefined();
  });

  it("lists the Lists a user owns or has joined", async () => {
    const ownerList = await queries.createList(db, { ownerId: "u-alice", name: "Owned" });
    const joinedList = await queries.createList(db, { ownerId: "u-bob", name: "Joined" });
    await queries.createMembership(db, { listId: joinedList.id, memberId: "u-alice" });

    const aliceIds = (await queries.getListsForMember(db, "u-alice")).map((l) => l.id);

    expect(aliceIds).toContain(ownerList.id);
    expect(aliceIds).toContain(joinedList.id);

    const bobIds = (await queries.getListsForMember(db, "u-bob")).map((l) => l.id);
    expect(bobIds).toContain(joinedList.id);
    expect(bobIds).not.toContain(ownerList.id);
  });

  it("updates and deletes a List", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Before" });

    const updated = await queries.updateList(db, list.id, { name: "After" });
    expect(updated?.name).toBe("After");

    await expect(queries.deleteList(db, list.id)).resolves.toBe(true);
    await expect(queries.getList(db, list.id)).resolves.toBeUndefined();
    await expect(queries.deleteList(db, list.id)).resolves.toBe(false);
  });

  it("creates, reads, updates, and deletes Item rows scoped to a List", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });
    const item = await queries.createItem(db, { listId: list.id, name: "Milk" });

    expect(item.checked).toBe(false);
    await expect(queries.getItem(db, item.id)).resolves.toEqual(item);

    const updated = await queries.updateItem(db, item.id, {
      checked: true,
      checkedAt: item.updatedAt,
    });
    expect(updated?.checked).toBe(true);
    expect(updated?.checkedAt).toBeTruthy();

    const items = await queries.getItemsByList(db, list.id);
    expect(items.map((i) => i.id)).toContain(item.id);

    await expect(queries.deleteItem(db, item.id)).resolves.toBe(true);
    await expect(queries.getItemsByList(db, list.id)).resolves.toHaveLength(0);
  });

  it("clears checkedAt when an Item is unchecked again", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });
    const item = await queries.createItem(db, { listId: list.id, name: "Milk" });

    const checked = await queries.updateItem(db, item.id, { checked: true });
    expect(checked?.checkedAt).toBeTruthy();

    const unchecked = await queries.updateItem(db, item.id, { checked: false });
    expect(unchecked?.checked).toBe(false);
    expect(unchecked?.checkedAt).toBeUndefined();
  });

  it("creates, reads, updates, and deletes Payment rows", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });
    const payment = await queries.createPayment(db, {
      listId: list.id,
      memberId: "u-buyer",
      amountInCents: 1275,
      paidAt: "2026-08-27T09:00:00.000Z",
    });

    expect(payment.amountInCents).toBe(1275);
    await expect(queries.getPayment(db, payment.id)).resolves.toEqual(payment);

    const updated = await queries.updatePayment(db, payment.id, { amountInCents: 1500 });
    expect(updated?.amountInCents).toBe(1500);

    const payments = await queries.getPaymentsByList(db, list.id);
    expect(payments.map((p) => p.id)).toContain(payment.id);

    await expect(queries.deletePayment(db, payment.id)).resolves.toBe(true);
  });

  it("creates, reads, updates, and deletes Invitation rows with a pending default", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });
    const invitation = await queries.createInvitation(db, {
      listId: list.id,
      email: "[EMAIL]",
      invitedById: "u-owner",
      token: "tok-secret",
    });

    expect(invitation.status).toBe("pending");
    expect(invitation.token).toBe("tok-secret");
    await expect(queries.getInvitation(db, invitation.id)).resolves.toEqual(invitation);

    const updated = await queries.updateInvitation(db, invitation.id, {
      status: "accepted",
    });
    expect(updated?.status).toBe("accepted");

    const invitations = await queries.getInvitationsByList(db, list.id);
    expect(invitations.map((i) => i.id)).toContain(invitation.id);

    await expect(queries.deleteInvitation(db, invitation.id)).resolves.toBe(true);
  });

  it("creates, reads, and deletes Membership rows", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });
    const membership = await queries.createMembership(db, {
      listId: list.id,
      memberId: "u-buyer",
    });

    expect(membership.joinedAt).toBeTruthy();
    await expect(
      queries.getMembership(db, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toEqual(membership);
    await expect(
      queries.getMembership(db, { listId: list.id, memberId: "u-stranger" }),
    ).resolves.toBeUndefined();

    const members = await queries.getMembershipsByList(db, list.id);
    expect(members.map((m) => m.memberId)).toContain("u-buyer");

    await expect(
      queries.deleteMembership(db, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBe(true);
    await expect(
      queries.getMembership(db, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBeUndefined();
  });

  it("treats the Owner as a Member before any Membership row exists", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });

    await expect(queries.isMember(db, list, "u-owner")).resolves.toBe(true);
  });

  it("admits a Member and rejects an outsider", async () => {
    const list = await queries.createList(db, { ownerId: "u-owner", name: "Shop" });
    await queries.createMembership(db, { listId: list.id, memberId: "u-buyer" });

    await expect(queries.isMember(db, list, "u-buyer")).resolves.toBe(true);
    await expect(queries.isMember(db, list, "u-stranger")).resolves.toBe(false);

    await queries.deleteMembership(db, { listId: list.id, memberId: "u-buyer" });
    await expect(queries.isMember(db, list, "u-buyer")).resolves.toBe(false);
  });
});
