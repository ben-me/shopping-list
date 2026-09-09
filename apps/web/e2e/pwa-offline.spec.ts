import { expect, test } from "@playwright/test";
import { addItem, createList, itemRow, signUp } from "./support";

/**
 * The PWA shell: after a first visit the service worker has cached the app
 * shell, so a cold start with no network opens the app on the last-synced
 * data from the local Store — not an error page, and never stale API data
 * served as if it were fresh.
 */
test("after a first visit, a cold start with no network opens the app on last-synced data", async ({
  page,
}) => {
  await signUp(page, "E2E PWA");
  await createList(page, "Pantry");
  await addItem(page, "Rice");

  await test.step("the service worker is active and the shell cache is warm", async () => {
    await page.waitForFunction(
      `async () => {
        const { isShellWarmed } = await import("/src/pwa.ts");
        return isShellWarmed();
      }`,
    );
  });

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
