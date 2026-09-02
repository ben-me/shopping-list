import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Repository } from "./repo";
import { runMigrations, startMiniflare, typedDb } from "./test-support";

describe("typed query helpers across the domain tables", () => {
  let mf: Miniflare;
  let repo: Repository;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-repo-db");
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    repo = new Repository(typedDb(binding));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates and reads back a List with domain typing", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Weekly shop" });

    expect(list.id).toBeTruthy();
    expect(list.name).toBe("Weekly shop");
    expect(list.ownerId).toBe("u-owner");
    expect(list.splitRule).toBe("equal");
    expect(list.createdAt).toBeTruthy();
    expect(list.updatedAt).toBeTruthy();

    await expect(repo.getList(list.id)).resolves.toEqual(list);
    await expect(repo.getList("missing")).resolves.toBeUndefined();
  });

  it("lists the Lists a user owns or has joined", async () => {
    const ownerList = await repo.createList({ ownerId: "u-alice", name: "Owned" });
    const joinedList = await repo.createList({ ownerId: "u-bob", name: "Joined" });
    await repo.createMembership({ listId: joinedList.id, memberId: "u-alice" });

    const aliceLists = await repo.getListsForMember("u-alice");
    const aliceIds = aliceLists.map((l) => l.id);

    expect(aliceIds).toContain(ownerList.id);
    expect(aliceIds).toContain(joinedList.id);

    const bobIds = (await repo.getListsForMember("u-bob")).map((l) => l.id);
    expect(bobIds).toContain(joinedList.id);
    expect(bobIds).not.toContain(ownerList.id);
  });

  it("updates and deletes a List", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Before" });

    const updated = await repo.updateList(list.id, { name: "After" });
    expect(updated?.name).toBe("After");
    expect(updated?.splitRule).toBe("equal");

    await expect(repo.deleteList(list.id)).resolves.toBe(true);
    await expect(repo.getList(list.id)).resolves.toBeUndefined();
    await expect(repo.deleteList(list.id)).resolves.toBe(false);
  });

  it("creates, reads, updates, and deletes Item rows scoped to a List", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });
    const item = await repo.createItem({ listId: list.id, name: "Milk" });

    expect(item.checked).toBe(false);
    await expect(repo.getItem(item.id)).resolves.toEqual(item);

    const updated = await repo.updateItem(item.id, { checked: true, checkedAt: item.updatedAt });
    expect(updated?.checked).toBe(true);
    expect(updated?.checkedAt).toBeTruthy();

    const items = await repo.getItemsByList(list.id);
    expect(items.map((i) => i.id)).toContain(item.id);

    await expect(repo.deleteItem(item.id)).resolves.toBe(true);
    await expect(repo.getItemsByList(list.id)).resolves.toHaveLength(0);
  });

  it("clears checkedAt when an Item is unchecked again", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });
    const item = await repo.createItem({ listId: list.id, name: "Milk" });

    const checked = await repo.updateItem(item.id, { checked: true });
    expect(checked?.checkedAt).toBeTruthy();

    const unchecked = await repo.updateItem(item.id, { checked: false });
    expect(unchecked?.checked).toBe(false);
    expect(unchecked?.checkedAt).toBeUndefined();
  });

  it("creates, reads, updates, and deletes Payment rows", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });
    const payment = await repo.createPayment({
      listId: list.id,
      memberId: "u-buyer",
      amountInCents: 1275,
      paidAt: "2026-08-27T09:00:00.000Z",
    });

    expect(payment.amountInCents).toBe(1275);
    await expect(repo.getPayment(payment.id)).resolves.toEqual(payment);

    const updated = await repo.updatePayment(payment.id, { amountInCents: 1500 });
    expect(updated?.amountInCents).toBe(1500);

    const payments = await repo.getPaymentsByList(list.id);
    expect(payments.map((p) => p.id)).toContain(payment.id);

    await expect(repo.deletePayment(payment.id)).resolves.toBe(true);
  });

  it("creates, reads, updates, and deletes Invitation rows with a pending default", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });
    const invitation = await repo.createInvitation({
      listId: list.id,
      email: "invitee@example.com",
      invitedById: "u-owner",
      token: "tok-secret",
    });

    expect(invitation.status).toBe("pending");
    expect(invitation.token).toBe("tok-secret");
    await expect(repo.getInvitation(invitation.id)).resolves.toEqual(invitation);

    const updated = await repo.updateInvitation(invitation.id, { status: "accepted" });
    expect(updated?.status).toBe("accepted");

    const invitations = await repo.getInvitationsByList(list.id);
    expect(invitations.map((i) => i.id)).toContain(invitation.id);

    await expect(repo.deleteInvitation(invitation.id)).resolves.toBe(true);
  });

  it("creates, reads, and deletes Membership rows", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });
    const membership = await repo.createMembership({ listId: list.id, memberId: "u-buyer" });

    expect(membership.joinedAt).toBeTruthy();
    await expect(repo.getMembership({ listId: list.id, memberId: "u-buyer" })).resolves.toEqual(
      membership,
    );
    await expect(
      repo.getMembership({ listId: list.id, memberId: "u-stranger" }),
    ).resolves.toBeUndefined();

    const members = await repo.getMembershipsByList(list.id);
    expect(members.map((m) => m.memberId)).toContain("u-buyer");

    await expect(repo.deleteMembership({ listId: list.id, memberId: "u-buyer" })).resolves.toBe(
      true,
    );
    await expect(
      repo.getMembership({ listId: list.id, memberId: "u-buyer" }),
    ).resolves.toBeUndefined();
  });

  it("treats the Owner as a Member before any Membership row exists", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });

    await expect(repo.isMember(list, { listId: list.id, memberId: "u-owner" })).resolves.toBe(true);
  });

  it("admits a Member and rejects an outsider", async () => {
    const list = await repo.createList({ ownerId: "u-owner", name: "Shop" });
    await repo.createMembership({ listId: list.id, memberId: "u-buyer" });

    await expect(repo.isMember(list, { listId: list.id, memberId: "u-buyer" })).resolves.toBe(true);
    await expect(repo.isMember(list, { listId: list.id, memberId: "u-stranger" })).resolves.toBe(
      false,
    );

    await repo.deleteMembership({ listId: list.id, memberId: "u-buyer" });
    await expect(repo.isMember(list, { listId: list.id, memberId: "u-buyer" })).resolves.toBe(
      false,
    );
  });
});
