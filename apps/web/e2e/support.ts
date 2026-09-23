import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { WEB_ORIGIN } from "../playwright.config";

/**
 * Shared helpers for the e2e specs: provision a user through the admin route,
 * sign them in, create a List, add, tick, and remove Items.
 *
 * Accounts are provisioned, not self-created (ADR 0003): `00-bootstrap` signs
 * up once on the empty database (that account becomes the Admin) and every
 * later account is created through the admin route with a unique email.
 */

export const PASSWORD = "e2e-secret-123";

/** better-auth CSRF-checks cookie POSTs against the browser's origin. */
const TRUSTED_ORIGIN = WEB_ORIGIN;

/** The one account the bootstrap spec creates; provisioning uses its session. */
export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "admin-e2e-password-123";

export function input(page: Page, formName: string) {
  return page.locator(`input[name="${formName}"]`);
}

/**
 * Sign the Admin in over the API and return the session cookie. A fresh
 * sign-in needs a fresh cookie, so sign out any stale session first.
 */
export async function adminCookie(request: APIRequestContext): Promise<string> {
  await request.post("/api/auth/sign-out", {
    headers: { origin: TRUSTED_ORIGIN },
    data: {},
  });
  const res = await request.post("/api/auth/sign-in/email", {
    headers: { origin: TRUSTED_ORIGIN },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const body = await res.text();
  if (!res.ok()) {
    throw new Error(`The Admin sign-in failed (${res.status()}): ${body}`);
  }
  const cookie = res
    .headersArray()
    .filter((header: { name: string; value: string }) => header.name.toLowerCase() === "set-cookie")
    .map((header: { name: string; value: string }) => header.value)
    .join("; ");
  if (!cookie) {
    throw new Error(`The Admin sign-in set no session cookie (${res.status()}): ${body}`);
  }
  return cookie;
}

/** Create an account through the admin route and return its credentials. */
export async function provisionUser(
  request: APIRequestContext,
  name: string,
): Promise<{ email: string; password: string }> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = PASSWORD;
  const created = await request.post("/api/auth/admin/create-user", {
    headers: { cookie: await adminCookie(request), origin: TRUSTED_ORIGIN },
    data: { name, email, password, role: "user", data: { emailVerified: true } },
  });
  expect(created, "provisioning via the admin route must succeed").toBeOK();
  return { email, password };
}

/** Sign an existing account in through the real sign-in form. */
export async function signInAsUser(page: Page, email: string, password: string = PASSWORD) {
  await page.goto("/");
  await input(page, "email").fill(email);
  await input(page, "password").fill(password);
  // Wait for the session cookie to be set before the caller navigates on.
  const signedIn = page.waitForResponse((response) =>
    response.url().includes("/api/auth/sign-in/email"),
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await signedIn;
}

/** Provision an account and sign it in through the real sign-in form. */
export async function signUp(page: Page, name: string, request: APIRequestContext) {
  const { email } = await provisionUser(request, name);
  await signInAsUser(page, email);
  await expect(page.getByText("Signed in as")).toContainText(name);
}

export async function signOut(page: Page) {
  // Wait for sign-out to reach the server before navigating away, or the
  // in-flight request can race the next sign-in and drop the new session.
  const signedOut = page.waitForResponse((response) =>
    response.url().includes("/api/auth/sign-out"),
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await signedOut;
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

export async function createList(page: Page, name: string) {
  await input(page, "name").fill(name);
  await page.getByRole("button", { name: "Create a List" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** The Members panel is a popover: it must be opened before its controls are used. */
export async function openMembers(page: Page) {
  await page.getByRole("button", { name: "Members" }).click();
}

export function itemRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

export function paymentRow(page: Page, amount: string) {
  return page.locator(".payments li").filter({ hasText: amount });
}

export async function addItem(page: Page, name: string) {
  await input(page, "item").fill(name);
  await page.getByRole("button", { name: "Add an Item" }).click();
  await expect(itemRow(page, name)).toBeVisible();
}

/**
 * Waits until the local Store reflects the expected Item state and the outbox
 * has drained, so a reload is guaranteed to show the same state. `checked:
 * null` waits for the Item to be gone.
 */
export function itemSettled(page: Page, name: string, checked: boolean | null) {
  const listId = new URL(page.url()).pathname.split("/").pop() ?? "";
  // Runs in the page: imports the app's own Store module and inspects its state.
  return page.waitForFunction(
    `async ({ listId, name, checked }) => {
      const { db } = await import("/src/db.ts");
      const items = await db.getItems(listId);
      const item = items.find((i) => i.name === name);
      if (checked === null) {
        if (item) return false;
      } else if (!item || item.checked !== checked) {
        return false;
      }
      const pending = await db.pendingOutboxEntries();
      return pending.length === 0;
    }`,
    { listId, name, checked },
  );
}
