import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuth, getTrustedOrigins, type AuthEnv } from "./auth";
import { createD1Connection, ping, type Db } from "./db";
import { BadRequestError, ForbiddenError, NotFoundError, toErrorEnvelope } from "./errors";
import { requireMember, requireUser, type AppVariables } from "./guards";
import {
  createList,
  createItem,
  deleteItem,
  getItem,
  getList,
  getItemsByList,
  getListsForMember,
  isMember,
  updateList,
  updateItem,
} from "./queries";

/**
 * The Shopping List API. Runs as a Cloudflare Worker and is the source of truth
 * for the domain (Lists, Items, Payments). The same wrangler target serves both
 * local dev and deployment. `createApp` builds a fresh Hono app so tests can
 * mount it with their own environment and requireUser/requireMember behaviour is
 * exercised over real HTTP as well as through middleware unit tests.
 *
 * The shared domain **data** contract (List, Item, Payment, Owed) lives in
 * `./domain` and is exposed to the web app through the
 * `@shopping-list/api/domain` subpath export, so the web app imports only the
 * data shapes and never pulls in this Worker entry (which drags in
 * `D1Database` types the browser does not have). Only the data shapes are part
 * of that contract — auth types stay in the `api`.
 */
export * from "./domain";

export type Bindings = AuthEnv;

type AppContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export function createApp() {
  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

  /**
   * Allow the web app (a separate origin in dev) to make authenticated requests
   * to the whole API. CORS with `credentials` requires an explicit origin — echo
   * back the request origin only when it is on the trusted list.
   */
  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        if (!origin) {
          return "";
        }
        return getTrustedOrigins(c.env).includes(origin) ? origin : "";
      },
      credentials: true,
    }),
  );

  /**
   * Mount better-auth. The D1 binding is only available inside the request, so
   * the auth instance is built per request from `c.env`. better-auth validates
   * the method and returns a `Response` that hono sends as-is.
   */
  app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

  /**
   * Every endpoint fails through the same error envelope: known {@link ApiError}s
   * keep their status, code, and message; anything else is a generic 500.
   */
  app.onError((error, c) => {
    const { status, envelope } = toErrorEnvelope(error);
    return c.json(envelope, status as ContentfulStatusCode);
  });

  /**
   * Health route: reachable unauthenticated — it must run before any require*
   * middleware.
   */
  app.get("/health", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const pingResult = await ping(db);
    return c.json({ ok: true, service: "shopping-list-api", db: pingResult?.ok === 1 });
  });

  app.get("/api/me", requireUser, (c) => c.json({ user: c.get("user") }));

  app.get("/api/lists/:listId", requireUser, requireMember, (c) => c.json({ list: c.get("list") }));

  /** The lists index: everything the signed-in user owns or has joined. */
  app.get("/api/lists", requireUser, async (c) => {
    const { db } = getRequestContext(c);
    const lists = await getListsForMember(db, c.get("user").id);
    return c.json({ lists });
  });

  /**
   * The Items on a List, oldest first. Members only — a non-Member gets a 403,
   * an unknown List a 404, both from {@link requireMember}.
   */
  app.get("/api/lists/:listId/items", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const items = await getItemsByList(db, listId);
    return c.json({ items });
  });

  /**
   * Sync upsert for an Item (offline-first add/tick/un-tick). The device generates
   * the id and sends the Item's current state; the server is the source of truth.
   * An unknown id creates the Item on this List; an existing Item updates only
   * when it actually belongs to this List and the caller is a Member. Ticking
   * stamps `checkedAt` (unless the client supplies one); un-ticking clears it.
   * No Payment is ever touched here — ticking and money are unrelated acts.
   */
  app.put("/api/lists/:listId/items/:itemId", requireUser, requireMember, async (c) => {
    const { db, listId, itemId } = getRequestContext(c);
    const itemUpdate = readItemUpdateFromBody(await readJsonBody(c));
    const existingItem = await getItemBelongingToList(db, listId, itemId);
    if (existingItem) {
      const item = await updateItem(db, itemId, itemUpdate);
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

  /**
   * Remove an Item from a List. Idempotent — removing an already-removed Item
   * still succeeds so an offline delete can be replayed safely. An Item that
   * exists but belongs to another List is a 404, not a delete. Payments are
   * independent rows and are never touched by an Item delete.
   */
  app.delete("/api/lists/:listId/items/:itemId", requireUser, requireMember, async (c) => {
    const { db, listId, itemId } = getRequestContext(c);
    await getItemBelongingToList(db, listId, itemId);
    await deleteItem(db, itemId);
    return c.json({ ok: true });
  });

  /**
   * Sync upsert for a List (offline-first create/rename). The device generates
   * the id and sends the whole List; the server is the source of truth. An unknown
   * id creates a List owned by the caller; an existing List updates only when
   * the caller is a Member.
   */
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
      return c.json({ list }, 200);
    }
    const list = await createList(db, {
      id: listId,
      ownerId: c.get("user").id,
      name: newListName,
    });
    return c.json({ list }, 201);
  });

  return app;
}

  function getRequestContext(c: AppContext) {
    return {
      db: createD1Connection(c.env.devDb),
      listId: c.req.param("listId") ?? "",
      itemId: c.req.param("itemId") ?? "",
    };
  }

  /**
   * Fetch an Item by id, enforcing that it belongs to the given List. Returns
   * the Item when it exists on that List, and `undefined` when no such Item
   * exists; an Item that exists on a *different* List is a 404, so any endpoint
   * built on this helper can never read or write across Lists.
   */
  async function getItemBelongingToList(db: Db, listId: string, itemId: string) {
    const existingItem = await getItem(db, itemId);
    if (existingItem && existingItem.listId !== listId) {
      throw new NotFoundError("Item not found");
    }
    return existingItem;
  }

  /** Type guard for an Item update body: name, checked, and checkedAt are all optional. */
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

  interface ItemUpdate {
    name?: string;
    checked?: boolean;
    checkedAt?: string;
  }

  /** Type guard for a List upsert body: name is required and non-blank. */
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

  async function readJsonBody(c: AppContext) {
    try {
      return await c.req.json();
    } catch {
      throw new BadRequestError("A JSON body is required");
    }
  }

const app = createApp();

export default {
  fetch: app.fetch,
};
