import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const lists = sqliteTable(
  "lists",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    splitRule: text("split_rule").notNull().default("equal"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("lists_owner_id_idx").on(t.ownerId)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.memberId] }),
    index("memberships_member_id_idx").on(t.memberId),
  ],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedById: text("invited_by_id").notNull(),
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

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull(),
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
