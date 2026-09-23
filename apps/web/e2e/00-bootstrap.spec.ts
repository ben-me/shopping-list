import { expect, test } from "@playwright/test";
import { WEB_ORIGIN } from "./env";
import { ADMIN_EMAIL, ADMIN_PASSWORD, input, signInAsUser } from "./support";

/**
 * The one-time bootstrap (ADR 0003): on an empty database, the very first
 * sign-up creates the Admin; afterwards sign-up is closed for good —
 * rejected server-side and hidden in the UI. Every other account in the e2e
 * suite is provisioned through the admin route (see support.ts).
 *
 * This spec MUST run on an empty database and before every other spec: the
 * file-name `00-` prefix plus a single worker (playwright.config.ts) order
 * it first, and the webServer command resets the isolated e2e D1 store before
 * each run (never the developer's dev database).
 */
test("an empty database bootstraps the Admin, then sign-up closes for good", async ({
  page,
  request,
}) => {
  await test.step("a stale database would break the bootstrap", async () => {
    const res = await request.get("/api/signup-status");
    expect(res).toBeOK();
    const { signUpOpen } = (await res.json()) as { signUpOpen: boolean };
    expect(
      signUpOpen,
      "sign-up must be open (empty user table). The e2e run resets its own isolated D1 store: pnpm --filter @shopping-list/api db:reset:e2e",
    ).toBe(true);
  });

  await test.step("the first sign-up creates the Admin", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create an account" }).click();
    await input(page, "name").fill("Bootstrap Admin");
    await input(page, "email").fill(ADMIN_EMAIL);
    await input(page, "password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Signed in as")).toContainText("Bootstrap Admin");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  await test.step("sign-up is hidden in the UI now that an account exists", async () => {
    await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
  });

  await test.step("sign-up is rejected server-side", async () => {
    const res = await request.post("/api/auth/sign-up/email", {
      data: {
        name: "Latecomer",
        email: "latecomer@e2e.test",
        password: "another-password",
      },
    });
    expect(res.status()).toBe(400);
    const status = await request.get("/api/signup-status");
    expect(await status.json()).toEqual({ signUpOpen: false });
  });

  await test.step("the Admin can sign in and provision a second account", async () => {
    const signIn = await request.post("/api/auth/sign-in/email", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(signIn).toBeOK();
    const cookie = signIn
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value)
      .join("; ");
    const created = await request.post("/api/auth/admin/create-user", {
      headers: { cookie, origin: WEB_ORIGIN },
      data: {
        name: "First Provisioned",
        email: "provisioned@e2e.test",
        password: "provisioned-password-123",
        role: "user",
        data: { emailVerified: true },
      },
    });
    expect(created).toBeOK();
    const { user } = (await created.json()) as { user: { email: string; role: string } };
    expect(user.role).toBe("user");
  });

  await test.step("the Admin provisions an account through the app UI", async () => {
    await signInAsUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.getByText("Signed in as Bootstrap Admin")).toBeVisible();

    // Only the Admin sees a Settings link, whose Add-a-user form provisions.
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Add a user" })).toBeVisible();
    await input(page, "add-user-name").fill("UI Provisioned");
    await input(page, "add-user-email").fill("uiprovisioned@e2e.test");
    await input(page, "add-user-password").fill("ui-provisioned-password");
    await page.getByRole("button", { name: "Add user" }).click();
    await expect(page.getByText("UI Provisioned can now sign in.")).toBeVisible();

    // The provisioned account signs in like any other.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await signInAsUser(page, "uiprovisioned@e2e.test", "ui-provisioned-password");
    await expect(page.getByText("Signed in as UI Provisioned")).toBeVisible();
  });
});
