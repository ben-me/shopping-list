import { eq } from "drizzle-orm";
import type { Db } from "../db";
import * as schema from "../schema";

/** Better-auth stores emails lowercased; it is also the comparison invariant for invitations. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const row = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, normalizeEmail(email)))
    .get();
  return row ? toUserRow(row) : undefined;
}

/** The bootstrap gate (ADR 0003): sign-up stays open only while no account exists. */
export async function usersExist(db: Db): Promise<boolean> {
  const row = await db.select({ id: schema.user.id }).from(schema.user).limit(1).get();
  return row !== undefined;
}

/** The user columns the API surfaces for invitations (never the password). */
export type UserRow = Pick<
  typeof schema.user.$inferSelect,
  "id" | "name" | "email" | "emailVerified" | "role" | "createdAt"
>;

function toUserRow(row: typeof schema.user.$inferSelect): UserRow {
  return { ...row };
}
