import { ref } from "vue";
import { pendingInvitations } from "./invitations";

/**
 * How many Invitations sit in the signed-in user's inbox, as the single read
 * surface for the Settings badge. Invitations are online-only (ADR 0003) —
 * there is nothing local to count — so the number is pulled from the server
 * and simply keeps its last value while offline.
 */
export const pendingInvitationCount = ref(0);

/** Pull the inbox size into {@link pendingInvitationCount}; offline keeps the last count. */
export async function refreshPendingInvitationCount(): Promise<void> {
  try {
    pendingInvitationCount.value = (await pendingInvitations()).length;
  } catch {
    // Offline: the inbox cannot be read; the badge keeps its last count.
  }
}
