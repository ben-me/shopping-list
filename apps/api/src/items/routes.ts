import type { Db } from "../db";
import { readRows } from "../etag";
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
    return readRows(c, "items", items);
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
      position: itemUpdate.position,
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

const ITEM_UPDATE_RULES: Record<keyof ItemUpdate, (value: unknown) => boolean> = {
  name: (value) => typeof value === "string" && value.trim() !== "",
  checked: (value) => typeof value === "boolean",
  checkedAt: (value) => typeof value === "string",
  position: (value) => typeof value === "number" && Number.isFinite(value),
};

/** A field the device left out is not sent at all; one it sends must be valid. */
function isItemUpdateBody(value: unknown): value is ItemUpdate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return Object.entries(ITEM_UPDATE_RULES).every(
    ([field, isValid]) => body[field] === undefined || isValid(body[field]),
  );
}

function readItemUpdateFromBody(body: unknown): ItemUpdate {
  if (!isItemUpdateBody(body)) {
    throw new BadRequestError("Invalid item update");
  }
  return { ...body, name: body.name?.trim() };
}
