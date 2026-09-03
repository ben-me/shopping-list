import type { Context, Next } from "hono";
import type { User } from "better-auth";
import { createAuth, type AuthEnv } from "./auth";
import { createD1Connection } from "./db";
import { getList, isMember } from "./queries";
import type { List } from "./domain";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";

/**
 * Values the app hands between middleware and handlers.
 * - `user` is set by {@link requireUser} after the session resolves.
 * - `list` is set by {@link requireMember} once the caller is proven to be a Member.
 */
export interface AppVariables {
  user: User;
  list: List;
}

type AppContext = Context<{ Bindings: AuthEnv; Variables: AppVariables }>;

export async function requireUser(c: AppContext, next: Next) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new UnauthorizedError();
  }
  c.set("user", session.user);
  await next();
}

export async function requireMember(c: AppContext, next: Next) {
  const db = createD1Connection(c.env.devDb);
  const list = await getList(db, c.req.param("listId") ?? "");
  if (!list) {
    throw new NotFoundError("List not found");
  }
  if (!(await isMember(db, list, c.get("user").id))) {
    throw new ForbiddenError("You are not a member of this list");
  }
  c.set("list", list);
  await next();
}
