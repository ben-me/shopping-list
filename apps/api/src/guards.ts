import type { Context, Next } from "hono";
import type { User } from "better-auth";
import { createAuth, type AuthEnv } from "./auth";
import { getList, isMember } from "./repository";
import type { List } from "./domain";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";

/**
 * Values the app hands between middleware and handlers.
 *
 * - `user` is set by {@link requestGuard} after the session resolves.
 * - `list` is set by {@link listGuard} once the caller is proven to be a Member.
 */
export interface AppVariables {
  user: User;
  list: List;
}

type GuardContext = Context<{ Bindings: AuthEnv; Variables: AppVariables }>;

/**
 * Resolve the signed-in user from the session cookie and reject the call when
 * there is no valid session. The acting user is stored on the context for
 * downstream middleware and handlers.
 */
export async function requestGuard(c: GuardContext, next: Next) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new UnauthorizedError();
  c.set("user", session.user);
  await next();
}

/**
 * Resolve the `:listId` route param to a List and reject the call when the
 * acting user (set by {@link requestGuard}) is not one of its Members. The
 * Owner is always a Member even before any Membership row exists.
 */
export async function listGuard(c: GuardContext, next: Next) {
  const list = await getList(c.env.devDb, c.req.param("listId") ?? "");
  if (!list) throw new NotFoundError("List not found");
  if (!(await isMember(c.env.devDb, list, c.get("user").id))) {
    throw new ForbiddenError("You are not a member of this list");
  }
  c.set("list", list);
  await next();
}
