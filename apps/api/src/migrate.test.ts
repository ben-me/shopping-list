import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { runMigrations, startMiniflare } from "./test-support";
import * as schema from "./schema";

describe("domain schema migrations on D1", () => {
  let mf: Miniflare;

  beforeEach(async () => {
    mf = await startMiniflare("local-d1-migrations-db");
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("runs the versioned migrations against a fresh D1 database", async () => {
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    const db = drizzle(binding);

    const names = await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    const tables = names.map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "lists",
        "memberships",
        "invitations",
        "items",
        "payments",
        "user",
        "session",
        "account",
        "verification",
        "__drizzle_migrations",
      ]),
    );
  });

  it("builds a typed client over the migrated schema and round-trips the domain tables", async () => {
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    const db = drizzle(binding, { schema });

    const now = "2026-08-27T09:00:00.000Z";

    const [list] = await db
      .insert(schema.lists)
      .values({
        id: "l-1",
        ownerId: "u-owner",
        name: "Weekly shop",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(schema.memberships).values([
      { listId: list.id, memberId: "u-owner", joinedAt: now },
      { listId: list.id, memberId: "u-buyer", joinedAt: now },
    ]);
    await db.insert(schema.invitations).values({
      id: "inv-1",
      listId: list.id,
      email: "invitee-user",
      invitedById: "u-owner",
      token: "tok-abc",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.items).values({
      id: "it-1",
      listId: list.id,
      name: "Milk",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.payments).values({
      id: "p-1",
      listId: list.id,
      memberId: "u-buyer",
      amountInCents: 1275,
      paidAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const item = await db.query.items.findFirst({ where: (t, { eq }) => eq(t.id, "it-1") });
    const payment = await db.query.payments.findFirst({
      where: (t, { eq }) => eq(t.id, "p-1"),
    });

    expect(item).toMatchObject({ id: "it-1", listId: list.id, name: "Milk", checked: false });
    expect(payment).toMatchObject({ amountInCents: 1275, memberId: "u-buyer" });
  });

  it("is idempotent — running the migrations twice does not error or duplicate", async () => {
    const binding = await mf.getD1Database("devDb");
    await runMigrations(binding);
    await runMigrations(binding);

    const db = drizzle(binding, { schema });
    const names = await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    const migrationTables = names.filter((r) => r.name === "__drizzle_migrations");

    expect(migrationTables).toHaveLength(1);
  });
});
