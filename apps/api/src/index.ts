import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuth, getTrustedOrigins, type AuthEnv } from "./auth";
import { createD1Connection, ping, type Db } from "./db";
import type { Item } from "./domain";
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
   * Health route: confirms the Worker is alive and serving, and that the D1
   * connection resolves. Runs before any require* middleware so it stays
   * reachable unauthenticated.
   */
  app.get("/health", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const row = await ping(db);
    return c.json({ ok: true, service: "shopping-list-api", db: row?.ok === 1 });
  });

  /**
   * Demonstration routes that exercise the shared plumbing. `/api/me` proves
   * requireUser resolves the signed-in user; `/api/lists/:listId` proves
   * requireMember admits Members and rejects everyone else. Slice endpoints
   * (creating a List, Items, Payments, …) build on these same helpers.
   */
  app.get("/api/me", requireUser, (c) => c.json({ user: c.get("user") }));

  app.get("/api/lists/:listId", requireUser, requireMember, (c) => c.json({ list: c.get("list") }));

  /**
   * The lists index: everything the signed-in user owns or has joined. Reads
   * go through the typed query helper so handlers never hand-roll SQL.
   */
  app.get("/api/lists", requireUser, async (c) => {
    const db = createD1Connection(c.env.devDb);
    const lists = await getListsForMember(db, c.get("user").id);
    return c.json({ lists });
  });

  /**
   * The Items on a List, oldest first. Members only — a non-Member gets a 403,
   * an unknown List a 404, both from {@link requireMember}.
   */
  app.get("/api/lists/:listId/items", requireUser, requireMember, async (c) => {
    const db = createD1Connection(c.env.devDb);
    const items = await getItemsByList(db, c.req.param("listId") ?? "");
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
    const db = createD1Connection(c.env.devDb);
    const listId = c.req.param("listId") ?? "";
    const itemId = c.req.param("itemId") ?? "";
    const patch = parseItemPatch(await readJsonBody(c));
    const existing = await getItemOnList(db, listId, itemId);
    if (existing) {
      const item = await updateItem(db, itemId, patch);
      return c.json({ item }, 200);
    }
    if (!patch.name) {
      throw new BadRequestError("Item name is required");
    }
    const item = await createItem(db, {
      id: itemId,
      listId,
      name: patch.name,
      checked: patch.checked,
      checkedAt: patch.checkedAt,
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
    const db = createD1Connection(c.env.devDb);
    const listId = c.req.param("listId") ?? "";
    const itemId = c.req.param("itemId") ?? "";
    await getItemOnList(db, listId, itemId);
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
    const db = createD1Connection(c.env.devDb);
    const listId = c.req.param("listId") ?? "";
    const name = parseListName(await readJsonBody(c));
    if (!listId) {
      throw new BadRequestError("List id is required");
    }
    const existing = await getList(db, listId);
    if (existing) {
      if (!(await isMember(db, existing, c.get("user").id))) {
        throw new ForbiddenError("You are not a member of this list");
      }
      const list = await updateList(db, listId, { name });
      return c.json({ list }, 200);
    }
    const list = await createList(db, {
      id: listId,
      ownerId: c.get("user").id,
      name,
    });
    return c.json({ list }, 201);
  });

  return app;
}

  /**
   * Fetch an Item by id, enforcing that it belongs to the given List. Returns
   * the Item when it exists on that List, and `undefined` when no such Item
   * exists; an Item that exists on a *different* List is a 404, so any endpoint
   * built on this helper can never read or write across Lists.
   */
  async function getItemOnList(db: Db, listId: string, itemId: string): Promise<Item | undefined> {
    const existing = await getItem(db, itemId);
    if (existing && existing.listId !== listId) {
      throw new NotFoundError("Item not found");
    }
    return existing;
  }

  /**
   * The body of an Item upsert is a patch: `name` (required and non-blank when
   * creating, optional-but-validated when updating), plus optional `checked` and
   * `checkedAt`. Anything malformed collapses to the same 400.
   */
  function parseItemPatch(body: unknown): ItemPatch {
    const body_ = body as { name?: unknown; checked?: unknown; checkedAt?: unknown };
    const patch: ItemPatch = {};
    if (body_.name !== undefined) {
      if (typeof body_.name !== "string" || body_.name.trim() === "") {
        throw new BadRequestError("Item name is required");
      }
      patch.name = body_.name.trim();
    }
    if (body_.checked !== undefined) {
      if (typeof body_.checked !== "boolean") {
        throw new BadRequestError("Item checked must be a boolean");
      }
      patch.checked = body_.checked;
    }
    if (body_.checkedAt !== undefined) {
      if (typeof body_.checkedAt !== "string") {
        throw new BadRequestError("Item checkedAt must be a string");
      }
      patch.checkedAt = body_.checkedAt;
    }
    return patch;
  }

  interface ItemPatch {
    name?: string;
    checked?: boolean;
    checkedAt?: string;
  }

  /**
   * The body of a List upsert is a single required field. A missing, malformed,
   * or blank body collapses to the same 400 so every client failure is legible.
   */
  function parseListName(body: unknown): string {
    const name = (body as { name?: unknown }).name;
    if (typeof name !== "string" || name.trim() === "") {
      throw new BadRequestError("List name is required");
    }
    return name.trim();
  }

  async function readJsonBody(c: AppContext): Promise<unknown> {
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
