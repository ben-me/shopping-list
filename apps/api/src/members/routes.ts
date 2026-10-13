import { ForbiddenError, NotFoundError } from "../errors";
import { requireMember, requireUser } from "../guards";
import type { App } from "../http";
import { getRequestContext } from "../http";
import { deleteMembership, getMembersWithNames } from "./queries";

export function registerMemberRoutes(app: App) {
  // Names are read online only; they never reach the offline Store.
  app.get("/api/lists/:listId/members", requireUser, requireMember, async (c) => {
    const { db } = getRequestContext(c);
    const members = await getMembersWithNames(db, c.get("list"));
    return c.json({ members });
  });

  app.delete("/api/lists/:listId/membership", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    if (c.get("list").ownerId === c.get("user").id) {
      throw new ForbiddenError("The Owner cannot leave their own List");
    }
    const removed = await deleteMembership(db, { listId, memberId: c.get("user").id });
    if (!removed) {
      throw new NotFoundError("Membership not found");
    }
    return c.json({ ok: true });
  });
}
