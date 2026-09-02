import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as repository from "./repository";
import { runMigrations, startMiniflare } from "./test-support";

describe("typed query helpers across the domain tables", () => {
  let mf: Miniflare;
  let devDb: D1Database;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-repository-db");
    devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates and reads back a List with domain typing", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Weekly shop" });

    expect(list.id).toBeTruthy();
    expect(list.name).toBe("Weekly shop");
    expect(list.ownerId).toBe("u-owner");
    expect(list.splitRule).toBe("equal");
    expect(list.createdAt).toBeTruthy();
    expect(list.updatedAt).toBeTruthy();

    await expect(repository.getList(devDb, list.id)).resolves.toEqual(list);
    await expect(repository.getList(devDb, "missing")).resolves.toBeUndefined();
  });

  it("lists the Lists a user owns or has joined", async () => {
    const ownerList = await repository.createList(devDb, { ownerId: "u-alice", name: "Owned" });
    const joinedList = await repository.createList(devDb, { ownerId: "u-bob", name: "Joined" });
    await repository.createMembership(devDb, { listId: joinedList.id, memberId: "u-alice" });

    const aliceIds = (await repository.getListsForMember(devDb, "u-alice")).map((l) => l.id);

    expect(aliceIds).toContain(ownerList.id);
    expect(aliceIds).toContain(joinedList.id);

    const bobIds = (await repository.getListsForMember(devDb, "u-bob")).map((l) => l.id);
    expect(bobIds).toContain(joinedList.id);
    expect(bobIds).not.toContain(ownerList.id);
  });

  it("updates and deletes a List", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Before" });

    const updated = await repository.updateList(devDb, list.id, { name: "After" });
    expect(updated?.name).toBe("After");
    expect(updated?.splitRule).toBe("equal");

    await expect(repository.deleteList(devDb, list.id)).resolves.toBe(true);
    await expect(repository.getList(devDb, list.id)).resolves.toBeUndefined();
    await expect(repository.deleteList(devDb, list.id)).resolves.toBe(false);
  });

  it("creates, reads, updates, and deletes Item rows scoped to a List", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });
    const item = await repository.createItem(devDb, { listId: list.id, name: "Milk" });

    expect(item.checked).toBe(false);
    await expect(repository.getItem(devDb, item.id)).resolves.toEqual(item);

    const updated = await repository.updateItem(devDb, item.id, {
      checked: true,
      checkedAt: item.updatedAt,
    });
    expect(updated?.checked).toBe(true);
    expect(updated?.checkedAt).toBeTruthy();

    const items = await repository.getItemsByList(devDb, list.id);
    expect(items.map((i) => i.id)).toContain(item.id);

    await expect(repository.deleteItem(devDb, item.id)).resolves.toBe(true);
    await expect(repository.getItemsByList(devDb, list.id)).resolves.toHaveLength(0);
  });

  it("clears checkedAt when an Item is unchecked again", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });
    const item = await repository.createItem(devDb, { listId: list.id, name: "Milk" });

    const checked = await repository.updateItem(devDb, item.id, { checked: true });
    expect(checked?.checkedAt).toBeTruthy();

    const unchecked = await repository.updateItem(devDb, item.id, { checked: false });
    expect(unchecked?.checked).toBe(false);
    expect(unchecked?.checkedAt).toBeUndefined();
  });

  it("creates, reads, updates, and deletes Payment rows", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });
    const payment = await repository.createPayment(devDb, {
      listId: list.id,
      memberId: "u-buyer",
      amountInCents: 1275,
      paidAt: "2026-08-27T09:00:00.000Z",
    });

    expect(payment.amountInCents).toBe(1275);
    await expect(repository.getPayment(devDb, payment.id)).resolves.toEqual(payment);

    const updated = await repository.updatePayment(devDb, payment.id, { amountInCents: 1500 });
    expect(updated?.amountInCents).toBe(1500);

    const payments = await repository.getPaymentsByList(devDb, list.id);
    expect(payments.map((p) => p.id)).toContain(payment.id);

    await expect(repository.deletePayment(devDb, payment.id)).resolves.toBe(true);
  });

  it("creates, reads, updates, and deletes Invitation rows with a pending default", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });
    const invitation = await repository.createInvitation(devDb, {
      listId: list.id,
      email: "[EMAIL]",
      invitedById: "u-owner",
      token: "tok-secret",
    });

    expect(invitation.status).toBe("pending");
    expect(invitation.token).toBe("tok-secret");
    await expect(repository.getInvitation(devDb, invitation.id)).resolves.toEqual(invitation);

    const updated = await repository.updateInvitation(devDb, invitation.id, {
      status: "accepted",
    });
    expect(updated?.status).toBe("accepted");

    const invitations = await repository.getInvitationsByList(devDb, list.id);
    expect(invitations.map((i) => i.id)).toContain(invitation.id);

    await expect(repository.deleteInvitation(devDb, invitation.id)).resolves.toBe(true);
  });

  it("creates, reads, and deletes Membership rows", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });
    const membership = await repository.createMembership(devDb, {
      listId: list.id,
      memberId: "u-buyer",
    });

    expect(membership.joinedAt).toBeTruthy();
    await expect(
      repository.getMembership(devDb, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toEqual(membership);
    await expect(
      repository.getMembership(devDb, { listId: list.id, memberId: "u-stranger" }),
    ).resolves.toBeUndefined();

    const members = await repository.getMembershipsByList(devDb, list.id);
    expect(members.map((m) => m.memberId)).toContain("u-buyer");

    await expect(
      repository.deleteMembership(devDb, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBe(true);
    await expect(
      repository.getMembership(devDb, { listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBeUndefined();
  });

  it("treats the Owner as a Member before any Membership row exists", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });

    await expect(repository.isMember(devDb, list, "u-owner")).resolves.toBe(true);
  });

  it("admits a Member and rejects an outsider", async () => {
    const list = await repository.createList(devDb, { ownerId: "u-owner", name: "Shop" });
    await repository.createMembership(devDb, { listId: list.id, memberId: "u-buyer" });

    await expect(repository.isMember(devDb, list, "u-buyer")).resolves.toBe(true);
    await expect(repository.isMember(devDb, list, "u-stranger")).resolves.toBe(false);

    await repository.deleteMembership(devDb, { listId: list.id, memberId: "u-buyer" });
    await expect(repository.isMember(devDb, list, "u-buyer")).resolves.toBe(false);
  });
});
