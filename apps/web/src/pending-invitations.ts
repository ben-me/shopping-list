import { ref } from "vue";
import type { PendingInvitation } from "@shopping-list/api/domain";
import { pendingInvitations } from "./invitations";

/**
 * How many Invitations sit in the signed-in user's inbox, as the single read
 * surface for the Settings badge. Invitations are online-only (ADR 0003) —
 * there is nothing local to count — so the number is pulled from the server
 * and simply keeps its last value while offline.
 */
export const pendingInvitationCount = ref(0);

/**
 * The one read of the inbox, and the only writer of the badge's count: every
 * screen that shows the Invitations gets them from here, so the list and the
 * count can never disagree. Rejects while offline; callers decide what that
 * means for them.
 */
export async function loadPendingInvitations(): Promise<PendingInvitation[]> {
  const invitations = await pendingInvitations();
  pendingInvitationCount.value = invitations.length;
  return invitations;
}

/** Refresh the badge from a fresh read; offline keeps the last count. */
export async function refreshPendingInvitationCount(): Promise<void> {
  try {
    await loadPendingInvitations();
  } catch {
    // Offline: the inbox cannot be read; the badge keeps its last count.
  }
}
