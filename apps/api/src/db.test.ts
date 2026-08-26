import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Connection, ping } from "./db";

describe("D1 connection via drizzle", () => {
  let mf: Miniflare;

  beforeEach(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "test",
            modules: true,
            script: `
              export default { fetch() { return new Response("ok"); } };
            `,
            d1Databases: { DB: "local-d1-test-db" },
          },
        ],
      }),
    );
    await mf.ready;
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("establishes a drizzle D1 connection from an env-provided binding", async () => {
    const binding = (await mf.getD1Database("DB")) as D1Database;
    const db = createD1Connection(binding);
    expect(db).toBeDefined();
  });

  it("resolves a query without a live network (dry-run binding)", async () => {
    const binding = (await mf.getD1Database("DB")) as D1Database;
    const db = createD1Connection(binding);
    const row = await ping(db);
    expect(row).toEqual({ ok: 1 });
  });
});
