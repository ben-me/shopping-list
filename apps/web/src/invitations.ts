import type { Invitation, ListInvitation, PendingInvitation } from "@shopping-list/api/domain";
import { apiFetch } from "./api";

/**
 * The in-app Invitation flow (ADR 0003): invite existing users by email (the
 * Owner), accept or decline from the invitee's inbox. Delivery is in-app only
 * — no email is ever sent. These calls are online-only: they mediate between
 * accounts, so unlike Items and Payments they never queue in the offline
 * outbox.
 */

/** The invitee's in-app inbox. */
export async function pendingInvitations(): Promise<PendingInvitation[]> {
  const body = await apiFetch<{ invitations?: PendingInvitation[] }>("/api/invitations");
  return body?.invitations ?? [];
}

export async function acceptInvitation(invitationId: string): Promise<void> {
  await apiFetch(`/api/invitations/${invitationId}/accept`, { method: "POST" });
}

/** Decline maps to `revoked` server-side, so the Invitation leaves both pending lists. */
export async function declineInvitation(invitationId: string): Promise<void> {
  await apiFetch(`/api/invitations/${invitationId}/decline`, { method: "POST" });
}

export async function listInvitations(listId: string): Promise<ListInvitation[]> {
  const body = await apiFetch<{ invitations?: ListInvitation[] }>(
    `/api/lists/${listId}/invitations`,
  );
  return body?.invitations ?? [];
}

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

export async function revokeInvitation(listId: string, invitationId: string): Promise<void> {
  await apiFetch(`/api/lists/${listId}/invitations/${invitationId}`, { method: "DELETE" });
}

/**
 */
