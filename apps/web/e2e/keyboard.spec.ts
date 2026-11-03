import { expect, test, type Locator, type Page } from "@playwright/test";
import { addItem, createList, input, signUp } from "./support";

const VIEWPORT = { width: 390, height: 800 };
const KEYBOARD = 320;
const ITEMS = Array.from(
  { length: 12 },
  (_, index) => `Item ${String(index + 1).padStart(2, "0")}`,
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      offsetTop: 0,
      scale: 1,
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

async function bottomOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return bottom(box!);
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
  const list = page.locator("main.page");

  await test.step("the entry bar and the list end above the keyboard", async () => {
    for (const bar of [input(page, "item"), list]) {
      expect(await bottomOf(bar)).toBeLessThanOrEqual(keyboardTop);
    }
  });

  const heights = await list.evaluate((el) => ({
    visible: el.clientHeight,
    all: el.scrollHeight,
  }));
  expect(heights.all).toBeGreaterThan(heights.visible);

  await test.step("scrolling reaches the last Item above the keyboard", async () => {
    await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    expect(await bottomOf(page.locator("main.page ul li").last())).toBeLessThanOrEqual(keyboardTop);
  });
});
