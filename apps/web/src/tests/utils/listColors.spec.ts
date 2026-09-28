import { listColors } from "../../utils/listColors";

describe("listColors", () => {
  it("draws the same pen for the same List, every time", () => {
    expect(listColors("weekly-shop")).toEqual(listColors("weekly-shop"));
  });

  it("returns var() references to the token palette, ready to bind", () => {
    const { accent, soft } = listColors("kiosk-stock");
    expect(accent).toMatch(/^var\(--palette-[1-6]\)$/);
    expect(soft).toMatch(/^var\(--palette-[1-6]-soft\)$/);
    expect(accent).not.toBe(soft);
  });

  it("spreads a handful of Lists over more than one pen", () => {
    const pens = new Set(
      ["Groceries", "Camping", "Kiosk", "Holiday", "Bakery", "Hardware"].map(
        (name) => listColors(name).accent,
      ),
    );
    expect(pens.size).toBeGreaterThan(1);
  });
});
