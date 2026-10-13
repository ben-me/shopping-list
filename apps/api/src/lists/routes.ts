import { BadRequestError, ForbiddenError, NotFoundError } from "../errors";
import { requireMember, requireUser } from "../guards";
import type { App } from "../http";
import { getRequestContext, readJsonBody } from "../http";
import { isMember } from "../members/queries";
import { createList, getList, getListsForMember, updateList } from "./queries";

export function registerListRoutes(app: App) {
  app.get("/api/lists/:listId", requireUser, requireMember, (c) => c.json({ list: c.get("list") }));

  app.get("/api/lists", requireUser, async (c) => {
    const { db } = getRequestContext(c);
    const lists = await getListsForMember(db, c.get("user").id);
    return c.json({ lists });
  });

  app.put("/api/lists/:listId", requireUser, async (c) => {
    const { db, listId } = getRequestContext(c);
    const newListName = readListNameFromBody(await readJsonBody(c));
    if (!listId) {
      throw new BadRequestError("List id is required");
    }
    const existingList = await getList(db, listId);
    if (existingList) {
      if (!(await isMember(db, existingList, c.get("user").id))) {
        throw new ForbiddenError("You are not a member of this list");
      }
      const list = await updateList(db, listId, { name: newListName });
      if (!list) {
        throw new NotFoundError("List not found");
      }
      return c.json({ list }, 200);
    }
    const list = await createList(db, {
      id: listId,
      ownerId: c.get("user").id,
      name: newListName,
    });
    return c.json({ list }, 201);
  });
}

function isListNameBody(value: unknown): value is { name: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { name } = value as Record<string, unknown>;
  return typeof name === "string" && name.trim() !== "";
}

function readListNameFromBody(body: unknown) {
  if (!isListNameBody(body)) {
    throw new BadRequestError("List name is required");
  }
  return body.name.trim();
}
