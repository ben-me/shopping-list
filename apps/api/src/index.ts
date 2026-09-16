import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuth, getTrustedOrigins, type AuthEnv } from "./auth";
import { createD1Connection, ping, type Db } from "./db";
import type { InvitationStatus, List } from "./domain";
import { BadRequestError, ForbiddenError, NotFoundError, toErrorEnvelope } from "./errors";
import { requireMember, requireUser, type AppVariables } from "./guards";
import {
  createInvitation,
  createList,
  createItem,
  createMembership,
  createPayment,
  deleteItem,
  deleteMembership,
  deletePayment,
  getInvitation,
  getInvitationsByListWithContext,
  getItem,
  getList,
  getItemsByList,
  getListsForMember,
  getMembersWithNames,
  getPayment,
  getPaymentsByList,
  getPendingInvitationsForEmail,
  getUserByEmail,
  hasPendingInvitationForListAndEmail,
  isMember,
  normalizeEmail,
  updateInvitation,
  updateList,
  updateItem,
  updatePayment,
  usersExist,
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
   * The web app runs on a separate origin, and CORS with `credentials` requires
   * an explicit origin — echo the request origin back only when it is trusted.
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
   * The D1 binding is only available inside the request, so the auth instance
   * is built per request from `c.env`.
   */
  app.all("/api/auth/*", async (c) => {
    const auth = await createAuth(c.env);
    return auth.handler(c.req.raw);
  });

  app.onError((error, c) => {
    const { status, envelope } = toErrorEnvelope(error);
    return c.json(envelope, status as ContentfulStatusCode);
  });

  app.get("/health", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const pingResult = await ping(db);
    return c.json({ ok: true, service: "shopping-list-api", db: pingResult?.ok === 1 });
  });

  app.get("/api/me", requireUser, (c) => c.json({ user: c.get("user") }));

  /**
   * The bootstrap gate the sign-in view renders against (ADR 0003): sign-up
   * is offered only while the user table is empty; the Admin provisions every
   * account after that.
   */
  app.get("/api/signup-status", async (c) => {
    const db = createD1Connection(c.env.devDb);
    const hasUsers = await usersExist(db);
    return c.json({ signUpOpen: !hasUsers });
  });

  /**
   * The invitee's in-app inbox (ADR 0003): every pending Invitation sent to
   * the signed-in user, with the inviting Owner's name and the List name.
   * Accepting or declining happens by invitation id.
   */
  app.get("/api/invitations", requireUser, async (c) => {
    const { db } = getRequestContext(c);
    const invitations = await getPendingInvitationsForEmail(db, c.get("user").email);
    return c.json({ invitations });
  });

  app.post("/api/invitations/:invitationId/accept", requireUser, inviteDecision("accepted"));

  /** Decline maps to `revoked` so the Invitation leaves both pending lists (ADR 0003). */
  app.post("/api/invitations/:invitationId/decline", requireUser, inviteDecision("revoked"));

  /** The List's Invitations, for its Members; only the Owner manages them. */
  app.get("/api/lists/:listId/invitations", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const invitations = await getInvitationsByListWithContext(db, listId);
    return c.json({ invitations });
  });

  /**
   * Everyone with access to a List, Owner first, with names — the client's
   * "who has access" list. Names never reach the offline Store; they are read
   * online, like the Invitation flow they belong to.
   */
  app.get("/api/lists/:listId/members", requireUser, requireMember, async (c) => {
    const { db } = getRequestContext(c);
    const members = await getMembersWithNames(db, c.get("list"));
    return c.json({ members });
  });

  /**
   * A Member leaves a List they joined: their Membership row is removed and
   * the List stops appearing for them. The Owner cannot leave — a List always
   * keeps the person who created it.
   */
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

  /** Only the Owner invites (existing users, by email) — never a non-Owner. */
  app.post("/api/lists/:listId/invitations", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    assertOwner(c, "invite");
    const email = readInviteEmailFromBody(await readJsonBody(c));
    const invitee = await getUserByEmail(db, email);
    if (!invitee) {
      throw new BadRequestError(
        "There's no account for that email — accounts are provisioned for this household",
      );
    }
    if (await isMember(db, c.get("list"), invitee.id)) {
      throw new BadRequestError("That user is already a member of this list");
    }
    if (await hasPendingInvitationForListAndEmail(db, listId, email)) {
      throw new BadRequestError("That user has already been invited");
    }
    const invitation = await createInvitation(db, {
      listId,
      email: normalizeEmail(email),
      invitedById: c.get("user").id,
      token: crypto.randomUUID(),
    });
    return c.json({ invitation }, 201);
  });

  /** Only the Owner revokes (closes) a pending Invitation; already-closed ones stay idempotent. */
  app.delete(
    "/api/lists/:listId/invitations/:invitationId",
    requireUser,
    requireMember,
    async (c) => {
      const { db, listId, invitationId } = getRequestContext(c);
      assertOwner(c, "revoke invitations");
      const invitation = await getInvitationBelongingToList(db, listId, invitationId);
      if (invitation && invitation.status === "pending") {
        await updateInvitation(db, invitation.id, { status: "revoked" });
      }
      return c.json({ ok: true });
    },
  );

  app.get("/api/lists/:listId", requireUser, requireMember, (c) => c.json({ list: c.get("list") }));

  app.get("/api/lists", requireUser, async (c) => {
    const { db } = getRequestContext(c);
    const lists = await getListsForMember(db, c.get("user").id);
    return c.json({ lists });
  });

  app.get("/api/lists/:listId/items", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const items = await getItemsByList(db, listId);
    return c.json({ items });
  });

  /**
   * Sync upsert (offline-first): the device generates the id and sends the
   * Item's current state; the server is the source of truth.
   */
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

  /** Idempotent so an offline delete can be replayed safely. */
  app.delete("/api/lists/:listId/items/:itemId", requireUser, requireMember, async (c) => {
    const { db, listId, itemId } = getRequestContext(c);
    await getItemBelongingToList(db, listId, itemId);
    await deleteItem(db, itemId);
    return c.json({ ok: true });
  });

  app.get("/api/lists/:listId/payments", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const payments = await getPaymentsByList(db, listId);
    return c.json({ payments });
  });

  /**
   * Sync upsert (offline-first). Only the fields the device sent are written,
   * so concurrent edits of one Payment reconcile per field (ADR 0001); a
   * Member never records or edits on behalf of someone else.
   */
  app.put("/api/lists/:listId/payments/:paymentId", requireUser, requireMember, async (c) => {
    const { db, listId, paymentId } = getRequestContext(c);
    const paymentUpdate = readPaymentUpdateFromBody(await readJsonBody(c));
    const existingPayment = await getPaymentBelongingToList(db, listId, paymentId);
    if (existingPayment) {
      if (existingPayment.memberId !== c.get("user").id) {
        throw new ForbiddenError("You can only edit your own payments");
      }
      const payment = await updatePayment(db, paymentId, paymentUpdate);
      if (!payment) {
        throw new NotFoundError("Payment not found");
      }
      return c.json({ payment }, 200);
    }
    if (paymentUpdate.amountInCents === undefined || paymentUpdate.paidAt === undefined) {
      throw new BadRequestError("A Payment needs an amount in cents and a date");
    }
    const payment = await createPayment(db, {
      id: paymentId,
      listId,
      memberId: c.get("user").id,
      amountInCents: paymentUpdate.amountInCents,
      paidAt: paymentUpdate.paidAt,
    });
    return c.json({ payment }, 201);
  });

  /** Idempotent so an offline delete can be replayed safely. */
  app.delete("/api/lists/:listId/payments/:paymentId", requireUser, requireMember, async (c) => {
    const { db, listId, paymentId } = getRequestContext(c);
    const existingPayment = await getPaymentBelongingToList(db, listId, paymentId);
    if (existingPayment && existingPayment.memberId !== c.get("user").id) {
      throw new ForbiddenError("You can only delete your own payments");
    }
    await deletePayment(db, paymentId);
    return c.json({ ok: true });
  });

  /** Sync upsert (offline-first): an unknown id creates a List owned by the caller. */
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

  return app;
}

function getRequestContext(c: AppContext) {
  return {
    db: createD1Connection(c.env.devDb),
    listId: c.req.param("listId") ?? "",
    itemId: c.req.param("itemId") ?? "",
    paymentId: c.req.param("paymentId") ?? "",
    invitationId: c.req.param("invitationId") ?? "",
  };
}

interface InvitationForInvitee {
  id: string;
  list: List;
  status: InvitationStatus;
}

/**
 * Both invitee decisions (accept, decline) share one shape: the Invitation
 * must exist, target the caller, and still be pending. Accept additionally
 * makes the caller a Member when they are not one already.
 */
function inviteDecision(status: "accepted" | "revoked") {
  return async (c: AppContext) => {
    const { db, invitationId } = getRequestContext(c);
    const invitation = await getInvitationForInvitee(db, invitationId, c.get("user").email);
    if (invitation.status !== "pending") {
      throw new BadRequestError("This invitation is no longer pending");
    }
    if (status === "accepted" && !(await isMember(db, invitation.list, c.get("user").id))) {
      await createMembership(db, { listId: invitation.list.id, memberId: c.get("user").id });
    }
    await updateInvitation(db, invitation.id, { status });
    return c.json({ ok: true });
  };
}

function assertOwner(c: AppContext, what: string) {
  if (c.get("user").id !== c.get("list").ownerId) {
    throw new ForbiddenError(`Only the Owner can ${what}`);
  }
}

/**
 * The Invitation an invitee may act on: it must exist, target the caller's
 * email (only the invitee accepts or declines), and its List must resolve.
 */
async function getInvitationForInvitee(
  db: Db,
  invitationId: string,
  inviteeEmail: string,
): Promise<InvitationForInvitee> {
  const invitation = await getInvitation(db, invitationId);
  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }
  if (invitation.email !== normalizeEmail(inviteeEmail)) {
    throw new ForbiddenError("This invitation was not sent to you");
  }
  const list = await getList(db, invitation.listId);
  if (!list) {
    throw new NotFoundError("Invitation not found");
  }
  return { id: invitation.id, list, status: invitation.status };
}

/**
 * An Invitation that belongs to a specific List; one on a different List is
 * a 404, so the revoke endpoint can never touch another List's invitation.
 */
async function getInvitationBelongingToList(db: Db, listId: string, invitationId: string) {
  const invitation = await getInvitation(db, invitationId);
  if (invitation && invitation.listId !== listId) {
    throw new NotFoundError("Invitation not found");
  }
  return invitation;
}

function isInviteEmailBody(value: unknown): value is { email: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { email } = value as Record<string, unknown>;
  return typeof email === "string" && email.trim() !== "";
}

function readInviteEmailFromBody(body: unknown) {
  if (!isInviteEmailBody(body)) {
    throw new BadRequestError("An email is required");
  }
  return body.email.trim();
}

/**
 * A Payment that exists on a different List is a 404, so endpoints built on
 * this helper can never read or write across Lists.
 */
async function getPaymentBelongingToList(db: Db, listId: string, paymentId: string) {
  const existingPayment = await getPayment(db, paymentId);
  if (existingPayment && existingPayment.listId !== listId) {
    throw new NotFoundError("Payment not found");
  }
  return existingPayment;
}

function isPaymentUpdateBody(value: unknown): value is { amountInCents?: number; paidAt?: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { amountInCents, paidAt } = value as Record<string, unknown>;
  if (
    amountInCents !== undefined &&
    (typeof amountInCents !== "number" || !Number.isInteger(amountInCents) || amountInCents <= 0)
  ) {
    return false;
  }
  if (paidAt !== undefined && (typeof paidAt !== "string" || paidAt.trim() === "")) {
    return false;
  }
  return amountInCents !== undefined || paidAt !== undefined;
}

function readPaymentUpdateFromBody(body: unknown) {
  if (!isPaymentUpdateBody(body)) {
    throw new BadRequestError("A Payment needs an amount in cents and a date");
  }
  const update: { amountInCents?: number; paidAt?: string } = {};
  if (body.amountInCents !== undefined) {
    update.amountInCents = body.amountInCents;
  }
  if (body.paidAt !== undefined) {
    update.paidAt = body.paidAt.trim();
  }
  return update;
}

/**
 * An Item that exists on a different List is a 404, so endpoints built on
 * this helper can never read or write across Lists.
 */
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

interface ItemUpdate {
  name?: string;
  checked?: boolean;
  checkedAt?: string;
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
