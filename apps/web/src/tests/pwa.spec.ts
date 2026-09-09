import { cacheKey, destinationOf } from "../pwa";

function entry(name: string, initiatorType: string): PerformanceResourceTiming {
  return { name, initiatorType } as unknown as PerformanceResourceTiming;
}

describe("destinationOf", () => {
  it("maps scripts to the script destination", () => {
    expect(destinationOf(entry("https://app.test/assets/index.js", "script"))).toBe("script");
  });

  it("maps link-initiated resources to the style destination", () => {
    expect(destinationOf(entry("https://app.test/assets/index.css", "link"))).toBe("style");
  });

  it("maps other initiators to no destination", () => {
    expect(destinationOf(entry("https://app.test/font.woff2", "css"))).toBe("");
    expect(destinationOf(entry("https://app.test/api/ping", "fetch"))).toBe("");
  });
});

describe("cacheKey", () => {
  it("appends the destination to URLs without a query", () => {
    expect(cacheKey("https://app.test/main.ts", "script")).toBe(
      "https://app.test/main.ts?sw-dest=script",
    );
  });

  it("joins with & when the URL already has a query", () => {
    expect(cacheKey("https://app.test/deps/vue.js?v=abc", "script")).toBe(
      "https://app.test/deps/vue.js?v=abc&sw-dest=script",
    );
  });

  it("keeps URLs without a destination unchanged", () => {
    expect(cacheKey("https://app.test/", "")).toBe("https://app.test/");
  });
});
