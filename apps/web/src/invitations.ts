import type { Invitation, ListInvitation, PendingInvitation } from "@shopping-list/api/domain";
import { apiFetch } from "./api";

/**
 * The in-app Invitation flow (ADR 0003): invite existing users by email (the
 * Owner), accept or decline from the invitee's inbox. Delivery is in-app only
 * — no email is ever sent. These calls are online-only: they mediate between
 * accounts, so unlike Items and Payments they never queue in the offline
 * outbox.
 */

/** The invitee's in-app inbox: every pending Invitation for the signed-in user. */
export async function pendingInvitations(): Promise<PendingInvitation[]> {
  const body = await apiFetch<{ invitations?: PendingInvitation[] }>("/api/invitations");
  return body?.invitations ?? [];
}

/** Accept makes the invitee a Member of the List with equal edit rights. */
export async function acceptInvitation(invitationId: string): Promise<void> {
  await apiFetch(`/api/invitations/${invitationId}/accept`, { method: "POST" });
}

/** Decline closes the Invitation (status `revoked`) so it leaves both pending lists. */
export async function declineInvitation(invitationId: string): Promise<void> {
  await apiFetch(`/api/invitations/${invitationId}/decline`, { method: "POST" });
}

/** The Invitations on one List, as its Members see them (any Member may view). */
export async function listInvitations(listId: string): Promise<ListInvitation[]> {
  const body = await apiFetch<{ invitations?: ListInvitation[] }>(
    `/api/lists/${listId}/invitations`,
  );
  return body?.invitations ?? [];
}

/** Only the Owner invites; the email must already belong to an account. */
export async function createInvitation(listId: string, email: string): Promise<Invitation> {
  const body = await apiFetch<{ invitation?: Invitation }>(`/api/lists/${listId}/invitations`, {
    method: "POST",
    body: { email },
  });
  if (!body?.invitation) {
    throw new Error("The invitation was not created");
  }
  return body.invitation;
}

/** Only the Owner revokes (closes) a pending Invitation. */
export async function revokeInvitation(listId: string, invitationId: string): Promise<void> {
  await apiFetch(`/api/lists/${listId}/invitations/${invitationId}`, { method: "DELETE" });
}

/**
 * Whether the one-time bootstrap sign-up is still open (ADR 0003). The sign-in
 * view shows the "Create an account" toggle only while this is true; when the
 * status cannot be reached it assumes sign-up is closed — provisioning is the
 * only door in, and that never happens through the sign-in view.
 */
export async function isSignUpOpen(): Promise<boolean> {
  try {
    const body = await apiFetch<{ signUpOpen?: boolean }>("/api/signup-status");
    return body?.signUpOpen === true;
  } catch {
    return false;
  }
}
