import type { Db } from "../db";
import { BadRequestError, NotFoundError } from "../errors";
import { requireMember, requireUser } from "../guards";
import type { App } from "../http";
import { getRequestContext, readJsonBody } from "../http";
import type { ItemUpdate } from "../domain";
import { createItem, deleteItem, getItem, getItemsByList, updateItem } from "./queries";

export function registerItemRoutes(app: App) {
  app.get("/api/lists/:listId/items", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const items = await getItemsByList(db, listId);
    return c.json({ items });
  });

  // Sync upsert: the device generates the id, the server is the source of truth.
  app.put("/api/lists/:listId/items/:itemId", requireUser, requireMember, async (c) => {
    const { db, listId, itemId } = getRequestContext(c);
    const itemUpdate = readItemUpdateFromBody(await readJsonBody(c));
    const existingItem = await getItemBelongingToList(db, listId, itemId);
    if (existingItem) {
      const item = await updateItem(db, itemId, itemUpdate);
      if (!item) {
        throw new NotFoundError("Item not found");
      }
      return c.json({ item }, 200);
    }
    if (!itemUpdate.name) {
      throw new BadRequestError("Item name is required");
    }
    const item = await createItem(db, {
      id: itemId,
      listId,
      name: itemUpdate.name,
      checked: itemUpdate.checked,
      checkedAt: itemUpdate.checkedAt,
    });
    return c.json({ item }, 201);
  });

  // Idempotent: an offline delete can be replayed.
  app.delete("/api/lists/:listId/items/:itemId", requireUser, requireMember, async (c) => {
    const { db, listId, itemId } = getRequestContext(c);
    await getItemBelongingToList(db, listId, itemId);
    await deleteItem(db, itemId);
    return c.json({ ok: true });
  });
}

// A cross-List id is a 404, never a cross-List read.
async function getItemBelongingToList(db: Db, listId: string, itemId: string) {
  const existingItem = await getItem(db, itemId);
  if (existingItem && existingItem.listId !== listId) {
    throw new NotFoundError("Item not found");
  }
  return existingItem;
}

function isItemUpdateBody(value: unknown): value is ItemUpdate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { name, checked, checkedAt } = value as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    return false;
  }
  if (checked !== undefined && typeof checked !== "boolean") {
    return false;
  }
  if (checkedAt !== undefined && typeof checkedAt !== "string") {
    return false;
  }
  return true;
}

function readItemUpdateFromBody(body: unknown) {
  if (!isItemUpdateBody(body)) {
    throw new BadRequestError("Invalid item update");
  }
  if (body.name === undefined) {
    return { name: undefined, checked: body.checked, checkedAt: body.checkedAt };
  }
  return {
    name: body.name.trim(),
    checked: body.checked,
    checkedAt: body.checkedAt,
  };
}
