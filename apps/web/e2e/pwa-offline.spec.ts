import { expect, test } from "@playwright/test";
import { addItem, createList, itemRow, signUp } from "./support";

/** Worker state polled live from the browser. */
const workerActive = `navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.active))`;
const loadControlled = `Boolean(navigator.serviceWorker.controller)`;
const shellCacheWarmed = `caches.keys().then(async (keys) => {
  for (const key of keys) {
    const cache = await caches.open(key);
    if ((await cache.keys()).length > 0) return true;
  }
  return false;
})`;

/**
 * The PWA shell: after a first visit the service worker has cached the app
 * shell, so a cold start with no network opens the app on the last-synced
 * data from the local Store — not an error page, and never stale API data
 * served as if it were fresh.
 */
test("after a first visit, a cold start with no network opens the app on last-synced data", async ({
  page,
  request,
}) => {
  await test.step("first visit: the service worker becomes active and the shell cache warms", async () => {
    await page.goto("/");
    // Dev precaches nothing at install: activate the worker, then reload into
    // its control so the NetworkFirst route warms the shell cache.
    await expect.poll(() => page.evaluate(workerActive), { timeout: 15_000 }).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(loadControlled)).toBe(true);
    await expect.poll(() => page.evaluate(shellCacheWarmed), { timeout: 15_000 }).toBe(true);
  });

  await signUp(page, "E2E PWA", request);
  await createList(page, "Pantry");
  await addItem(page, "Rice");

  await test.step("go offline and cold-start the app in a fresh page", async () => {
    await page.context().setOffline(true);
    const cold = await page.context().newPage();
    await cold.goto("/");
    await expect(cold.getByRole("heading", { name: "Shopping Lists" })).toBeVisible();
    await expect(cold.getByRole("link", { name: "Pantry" })).toBeVisible();

    await cold.getByRole("link", { name: "Pantry" }).click();
    await expect(cold.getByRole("heading", { name: "Pantry" })).toBeVisible();
    await expect(itemRow(cold, "Rice")).toBeVisible();
  });

  await test.step("the service worker never cached API responses", async () => {
    // The local Store is the read source: the shell cache holds only app
    // shell assets, so it can never serve stale data as if it were fresh.
    const apiCached = await page.evaluate(
      `(async () => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            if (new URL(request.url).pathname.startsWith("/api/")) return true;
          }
        }
        return false;
      })()`,
    );
    expect(apiCached).toBe(false);
  });
});
