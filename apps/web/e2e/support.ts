import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { WEB_ORIGIN } from "../playwright.config";

/**
 * Shared helpers for the e2e specs: the real provisioned flow against the
 * isolated e2e stack — provision a user through the admin route, sign them in,
 * create a List, add, tick, and remove Items.
 *
 * Accounts are provisioned, not self-created (ADR 0003): the `00-bootstrap`
 * spec signs up once on the empty database — that first account becomes the
 * Admin — and every later account in this file is created through the admin
 * route with a unique email, so reruns never collide.
 */

export const PASSWORD = "e2e-secret-123";

/** The one account the bootstrap spec creates; provisioning uses its session. */
/** The e2e origin the browser talks to; better-auth CSRF-checks cookie POSTs against it. */
const TRUSTED_ORIGIN = WEB_ORIGIN;

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "admin-e2e-password-123";

export function input(page: Page, formName: string) {
  return page.locator(`input[name="${formName}"]`);
}

/**
 * Sign the Admin in over the API and return the session cookie.
 *
 * A fresh APIRequestContext per call: an inherited session cookie would make
 * better-auth answer the sign-in with the existing session and no new
 * cookie, so provisioning must never depend on cross-test cookie state.
 */
export async function adminCookie(request: APIRequestContext): Promise<string> {
  // The `request` fixture may carry an earlier test's session cookie, and a
  // sign-in with a live session answers with the existing session and no new
  // cookie. Sign the stale session out first so the fresh sign-in always
  // mints (and sets) a new one.
  await request.post("/api/auth/sign-out", {
    headers: { origin: TRUSTED_ORIGIN },
    data: {},
  });
  const res = await request.post("/api/auth/sign-in/email", {
    // The e2e browser origin: better-auth CSRF-checks cookie-bearing POSTs
    // against trusted origins; sending it up front makes the check a no-op.
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

/**
 * Create an account through the admin route (email-verified by provisioning)
 * and return its credentials. The account exists on the server; this helper
 * does not touch the browser.
 */
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
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Provision an account and sign it in through the real sign-in form, landing
 * on the signed-in lists view. Sign-up itself happens only in the bootstrap
 * spec — every other account is provisioned by the Admin.
 */
export async function signUp(page: Page, name: string, request: APIRequestContext) {
  const { email } = await provisionUser(request, name);
  await signInAsUser(page, email);
  await expect(page.getByText("Signed in as")).toContainText(name);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

export async function createList(page: Page, name: string) {
  await input(page, "name").fill(name);
  await page.getByRole("button", { name: "Create a List" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
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
 * Waits until the app's local Store reflects the expected Item state and its
 * outbox has fully drained — i.e. the action is durably committed locally and
 * nothing is left to sync. Only then is a reload guaranteed to show the same
 * state, whatever order the app syncs in. `checked: null` waits for the Item
 * to be gone (removal).
 */
export function itemSettled(page: Page, name: string, checked: boolean | null) {
  const listId = new URL(page.url()).pathname.split("/").pop() ?? "";
  // The predicate runs in the page (string form, so it is not type-checked
  // against the test's modules): it imports the app's own Store module — the
  // same instance the app uses — and inspects its real state.
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
