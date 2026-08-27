import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Source-of-truth domain schema for the Shopping List server (D1/sqlite).
 *
 * These tables back the shared domain model described in `spec.md` and
 * `CONTEXT.md`: Users, Lists, Memberships, Invitations, Items, Payments.
 * Timestamps are stored as ISO-8601 strings (the same shape the shared data
 * contract in `domain.ts` exposes); amounts are integers in EUR minor units
 * (cents) to avoid float drift.
 *
 * Ownership lives on `lists.owner_id` only — the Owner is also a Member, and
 * that is expressed by requiring the Owner to have a `memberships` row, so
 * there is a single source of truth for who owns a list.
 */

/** A person who can own lists and join them as a Member. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A shared checklist owned by exactly one user. `split_rule` is carried as a
 * field (ADR-0002) so other split rules can slot in later without a data
 * migration; the MVP only ships `equal`.
 */
export const lists = sqliteTable(
  "lists",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    splitRule: text("split_rule").notNull().default("equal"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("lists_owner_id_idx").on(t.ownerId)],
);

/**
 * The Member roster of a List. The Owner is also a Member and must have a row
 * here; whether someone is the Owner is read from `lists.owner_id`, never from
 * this table, so ownership has a single source of truth.
 */
export const memberships = sqliteTable(
  "memberships",
  {
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => users.id),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.memberId] }),
    index("memberships_member_id_idx").on(t.memberId),
  ],
);

/**
 * A pending offer for a user to join a List as a Member. Distinguished from a
 * Membership — an Invitation is not yet a Member. Delivered by email (the only
 * outbound notification in the MVP); the token backs the accept flow.
 */
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    token: text("token").notNull().unique(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("invitations_list_id_idx").on(t.listId),
    index("invitations_email_idx").on(t.email),
  ],
);

/** A single thing someone intends to buy; can be ticked off independently of any Payment. */
export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
    checkedAt: text("checked_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("items_list_id_idx").on(t.listId)],
);

/**
 * A dated amount (in EUR minor units) a Member recorded against a List. A free
 * amount standing alone — not attached to any Item. One row per Payment, keyed
 * to the List, so sync never merges or dedupes side-by-side Payments.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => users.id),
    amountInCents: integer("amount_in_cents").notNull(),
    paidAt: text("paid_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("payments_list_id_idx").on(t.listId),
    index("payments_member_id_idx").on(t.memberId),
  ],
);
