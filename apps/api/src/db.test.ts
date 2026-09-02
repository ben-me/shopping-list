import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Connection, ping } from "./db";
import { startMiniflare } from "./test-support";

describe("D1 connection via drizzle", () => {
  let mf: Miniflare;

  beforeEach(async () => {
    mf = await startMiniflare("local-d1-test-db");
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("establishes a drizzle D1 connection from an env-provided binding", async () => {
    const binding = await mf.getD1Database("devDb");
    const db = createD1Connection(binding);
    expect(db).toBeDefined();
  });

  it("resolves a query without a live network (dry-run binding)", async () => {
    const binding = await mf.getD1Database("devDb");
    const db = createD1Connection(binding);
    const row = await ping(db);
    expect(row).toEqual({ ok: 1 });
  });
});
