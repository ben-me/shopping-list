import { expect, test } from "@playwright/test";
import { addItem, createList, input, provisionUser, signInAsUser } from "./support";

/**
 * The in-app Invitation flow (ADR 0003): the Owner invites an existing user
 * by email, the invitee sees the pending Invitation when signed in (Owner's
 * name + List name) and accepts or declines; a decline maps to `revoked`,
 * so it leaves both pending lists. No email is ever sent — the whole flow
 * lives inside the app.
 */

test("the Owner invites a user who accepts in-app and gets equal edit rights", async ({
  page,
  request,
}) => {
  const owner = await provisionUser(request, "Ada");
  const invitee = await provisionUser(request, "Bo");
  await signInAsUser(page, owner.email);
  await createList(page, "Weekend shop");

  await test.step("the Owner invites by email and the Invitation appears on the List", async () => {
    await input(page, "invite-email").fill(invitee.email);
    await page.getByRole("button", { name: "Invite a member" }).click();
    await expect(page.locator(".invitations li").filter({ hasText: invitee.email })).toContainText(
      "invited",
    );
  });

  await test.step("inviting a non-existent account is rejected with an actionable error", async () => {
    await input(page, "invite-email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Invite a member" }).click();
    await expect(page.getByText("no account for that email")).toBeVisible();
  });

  await test.step("inviting someone already invited is rejected", async () => {
    await input(page, "invite-email").fill(invitee.email);
    await page.getByRole("button", { name: "Invite a member" }).click();
    await expect(page.getByText("already been invited")).toBeVisible();
  });

  await test.step("the invitee sees the pending Invitation and accepts in-app", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await signInAsUser(page, invitee.email);
    await expect(page.getByText("Ada invited you to Weekend shop")).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();

    // Accepting makes them a Member: the List appears and can be edited.
    await expect(page.getByRole("link", { name: "Weekend shop" })).toBeVisible();
    await page.getByRole("link", { name: "Weekend shop" }).click();
    await expect(page.getByRole("heading", { name: "Weekend shop" })).toBeVisible();
    await addItem(page, "Olive oil");

    // The invitee is a Member with equal edit rights, and every device now
    // knows both Members — the standing re-divides for the real group.
    await expect(page.locator(".standing-member")).toHaveCount(2);
  });
});

test("a declined invitation closes for both sides; the Owner can also revoke", async ({
  page,
  request,
}) => {
  const owner = await provisionUser(request, "Chris");
  const invitee = await provisionUser(request, "Dana");
  await signInAsUser(page, owner.email);
  await createList(page, "Holiday shop");

  await test.step("the Owner invites, then revokes the pending Invitation", async () => {
    await input(page, "invite-email").fill(invitee.email);
    await page.getByRole("button", { name: "Invite a member" }).click();
    const row = page.locator(".invitations li").filter({ hasText: invitee.email });
    await expect(row).toContainText("invited");

    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("closed");
  });

  await test.step("a closed Invitation can be sent again, and the invitee declines it", async () => {
    await input(page, "invite-email").fill(invitee.email);
    await page.getByRole("button", { name: "Invite a member" }).click();
    await expect(page.locator(".invitations li").filter({ hasText: invitee.email })).toContainText(
      "invited",
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await signInAsUser(page, invitee.email);
    await expect(page.getByText("Chris invited you to Holiday shop")).toBeVisible();
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Chris invited you to Holiday shop")).toHaveCount(0);
  });

  await test.step("decline maps to revoked: the Owner sees the Invitation closed", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await signInAsUser(page, owner.email);
    await page.getByRole("link", { name: "Holiday shop" }).click();
    await expect(page.getByRole("heading", { name: "Holiday shop" })).toBeVisible();
    // Both the Owner-revoked and the declined invitations are closed.
    const closed = page.locator(".invitations li").filter({ hasText: "closed" });
    await expect(closed).toHaveCount(2);
  });
});
