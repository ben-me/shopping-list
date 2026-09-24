<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { ListInvitation, MemberDetails } from "@shopping-list/api/domain";
import { onSyncPass } from "../connectivity";
import { createInvitation, listInvitations, revokeInvitation } from "../invitations";
import { listMembers } from "../members";
import { session } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const props = defineProps<{ listId: string }>();

const members = ref<MemberDetails[]>([]);
const invitations = ref<ListInvitation[]>([]);
const error = ref<string | null>(null);
const loaded = ref(false);
const inviteForm = ref({
  email: "",
  submitting: false,
});

/** The server always lists the Owner first, so the first row names them. */
const isOwner = () => members.value[0]?.memberId === session.user?.id;

const statusLabel = (status: ListInvitation["status"]) =>
  status === "pending" ? "invited" : status === "accepted" ? "joined" : "closed";

async function loadMembers() {
  members.value = await listMembers(props.listId);
}

async function loadInvitations() {
  invitations.value = await listInvitations(props.listId);
}

async function loadPanel() {
  await logRejection(loadMembers(), "Loading the members");
  await logRejection(loadInvitations(), "Loading the invitations");
  loaded.value = true;
}

async function onInvite() {
  error.value = null;
  inviteForm.value.submitting = true;
  try {
    await createInvitation(props.listId, inviteForm.value.email);
    await logRejection(loadInvitations(), "Loading the invitations");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not send the invitation";
    return;
  } finally {
    inviteForm.value.submitting = false;
  }
  inviteForm.value.email = "";
}

async function onRevoke(invitation: ListInvitation) {
  await logRejection(revokeInvitation(props.listId, invitation.id), "Revoking the invitation");
  await logRejection(loadInvitations(), "Loading the invitations");
}

let stopSyncPass: (() => void) | null = null;

const opened = ref(false);

/**
 * Members and Invitations are server-only, and a closed popover shows
 * nothing — so the first read waits for the open. Reading on mount would cost
 * every List screen two Members requests, because the screen starts a Sync
 * pass right after mounting and that pass refreshes an open panel again.
 */
function onOpen() {
  if (opened.value) {
    return;
  }
  opened.value = true;
  void loadPanel();
}

onMounted(() => {
  stopSyncPass = onSyncPass(async () => {
    if (!opened.value) {
      return;
    }
    // A Sync pass may have pulled a Membership the server created since the
    // panel opened (an accepted Invitation elsewhere); re-read so the access
    // list is never stale.
    await ignoreRejection(loadMembers());
    await ignoreRejection(loadInvitations());
  });
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <div class="members-list">
    <button
      type="button"
      class="tab members-toggle"
      aria-haspopup="dialog"
      popovertarget="members-panel"
      @click="onOpen"
    >
      Members
    </button>
    <dialog id="members-panel" popover class="members-dialog" aria-labelledby="members-heading">
      <div class="members-panel">
        <button
          type="button"
          class="members-close"
          popovertarget="members-panel"
          popovertargetaction="close"
        >
          Close
        </button>
        <h2 id="members-heading">Members</h2>
        <p v-if="!loaded" class="muted">Loading…</p>
        <ul v-else class="member-names">
          <li v-for="member in members" :key="member.memberId">
            {{ member.memberId === session.user?.id ? `${member.name} (you)` : member.name }}
          </li>
        </ul>
        <template v-if="isOwner()">
          <h3>Invitations</h3>
          <p v-if="invitations.length === 0" class="empty">Nobody invited yet.</p>
          <ul class="invitations">
            <li
              v-for="invitation in invitations.filter((invite) => invite.status !== 'accepted')"
              :key="invitation.id"
            >
              <span>{{ invitation.email }}</span>
              <span class="invitation-status">({{ statusLabel(invitation.status) }})</span>
              <button
                v-if="invitation.status === 'pending'"
                type="button"
                name="revoke-invitation"
                :aria-label="`Revoke invitation for ${invitation.email}`"
                @click="onRevoke(invitation)"
              >
                Revoke
              </button>
            </li>
          </ul>
          <form class="invite-form" @submit.prevent="onInvite">
            <label>
              Email
              <input v-model="inviteForm.email" name="invite-email" type="email" />
            </label>
            <button type="submit" :disabled="inviteForm.submitting">Invite a member</button>
          </form>
        </template>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.members-list {
  display: flex;
  margin-inline-start: auto;
}

.members-toggle {
  anchor-name: --members;
}

/* Popovers render in the top layer, so they position against the viewport, not
   the DOM parent. The panel drops below the button, right-aligned to the edge
   so it cannot fall off a phone screen. */
.members-dialog {
  position: fixed;
  position-anchor: --members;
  inset: auto var(--space-4) auto auto;
  top: anchor(--members bottom);
  margin: 0.25rem 0 0;
  width: max-content;
  max-width: min(24rem, calc(100vw - 2rem));
  padding: var(--space-4);
  border: 1px solid var(--color-ink);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.members-dialog:focus {
  outline: none;
}

.members-close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

.members-panel {
  display: grid;
  gap: var(--space-3);
  align-content: start;
}

.members-panel h2 {
  padding-inline-end: var(--space-6);
}

.member-names {
  list-style: none;
  padding: 0;
  margin: 0;
}

.invitations {
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-rule);
  }
}

.invitation-status {
  color: var(--color-text-muted);
  font-size: var(--fs-small);
}

.invitations button {
  margin-inline-start: auto;
}
</style>
