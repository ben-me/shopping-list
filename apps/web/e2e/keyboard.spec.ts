import { expect, test, type Page } from "@playwright/test";
import { addItem, createList, input, signUp } from "./support";

const VIEWPORT = { width: 390, height: 800 };
const KEYBOARD = 320;
const ITEMS = [
  "Milk",
  "Eggs",
  "Bread",
  "Butter",
  "Cheese",
  "Apples",
  "Bananas",
  "Coffee",
  "Tea",
  "Rice",
  "Pasta",
  "Tomatoes",
];

/**
 * An on-screen keyboard overlays the layout viewport, which is the thing the
 * app watches through `window.visualViewport`. No desktop browser opens one,
 * so the test fakes that interface and shrinks it by hand.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      offsetTop: 0,
    });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  });
});

async function openKeyboard(page: Page, covered: number) {
  await page.evaluate((inset) => {
    const viewport = window.visualViewport as unknown as {
      height: number;
      dispatchEvent(event: Event): boolean;
    };
    viewport.height = window.innerHeight - inset;
    viewport.dispatchEvent(new Event("resize"));
  }, covered);
}

function bottom(box: { y: number; height: number }) {
  return Math.round(box.y + box.height);
}

test("the List ends above the on-screen keyboard and scrolls to its last Item", async ({
  page,
  request,
}) => {
  await page.setViewportSize(VIEWPORT);
  await signUp(page, "Keyboard Tester", request);
  await createList(page, "Groceries");
  for (const name of ITEMS) {
    await addItem(page, name);
  }

  await input(page, "item").focus();
  await openKeyboard(page, KEYBOARD);

  const keyboardTop = VIEWPORT.height - KEYBOARD;
  const app = await page.locator("#app").boundingBox();
  expect(app).not.toBeNull();
  expect(bottom(app!)).toBe(keyboardTop);

  await test.step("the entry bar and the list end above the keyboard", async () => {
    for (const bar of [input(page, "item"), page.locator("main.page")]) {
      const box = await bar.boundingBox();
      expect(box).not.toBeNull();
      expect(bottom(box!)).toBeLessThanOrEqual(keyboardTop);
    }
  });

  const list = page.locator("main.page");
  const heights = await list.evaluate((el) => ({
    visible: el.clientHeight,
    all: el.scrollHeight,
  }));
  expect(heights.all).toBeGreaterThan(heights.visible);

  const last = page.locator("main.page ul li").last();
  const behind = await last.boundingBox();
  expect(behind).not.toBeNull();
  expect(bottom(behind!)).toBeGreaterThan(keyboardTop);

  await test.step("scrolling reaches the last Item above the keyboard", async () => {
    await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    const box = await last.boundingBox();
    expect(box).not.toBeNull();
    expect(bottom(box!)).toBeLessThanOrEqual(keyboardTop);
    await expect(last).toBeVisible();
  });

  await test.step("the Payments footer keeps its place on the keyboard's edge", async () => {
    await page.getByRole("link", { name: "Payments" }).click();

    const footer = await page.locator("footer").boundingBox();
    expect(footer).not.toBeNull();
    expect(bottom(footer!)).toBe(keyboardTop);
  });
});
