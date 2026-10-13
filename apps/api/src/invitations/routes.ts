import type { InvitationStatus, List } from "../domain";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors";
import { requireMember, requireUser } from "../guards";
import type { App, AppContext } from "../http";
import { getRequestContext, readJsonBody } from "../http";
import type { Db } from "../db";
import { getList } from "../lists/queries";
import { createMembership, isMember } from "../members/queries";
import { normalizeEmail, getUserByEmail } from "../users/queries";
import {
  createInvitation,
  getInvitation,
  getInvitationsByListWithContext,
  getPendingInvitationsForEmail,
  hasPendingInvitationForListAndEmail,
  updateInvitation,
} from "./queries";

export function registerInvitationRoutes(app: App) {
  app.get("/api/invitations", requireUser, async (c) => {
    const { db } = getRequestContext(c);
    const invitations = await getPendingInvitationsForEmail(db, c.get("user").email);
    return c.json({ invitations });
  });

  app.post("/api/invitations/:invitationId/accept", requireUser, inviteDecision("accepted"));

  // Decline reuses `revoked` so it leaves both pending lists (ADR 0003).
  app.post("/api/invitations/:invitationId/decline", requireUser, inviteDecision("revoked"));

  app.get("/api/lists/:listId/invitations", requireUser, requireMember, async (c) => {
    const { db, listId } = getRequestContext(c);
    const invitations = await getInvitationsByListWithContext(db, listId);
    return c.json({ invitations });
  });

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
}

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

interface InvitationForInvitee {
  id: string;
  list: List;
  status: InvitationStatus;
}

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

// A cross-List id is a 404, never a cross-List read.
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
