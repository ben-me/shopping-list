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

onMounted(() => {
  void logRejection(loadMembers(), "Loading the members");
  void logRejection(loadInvitations(), "Loading the invitations");
  stopSyncPass = onSyncPass(async () => {
    // A Sync pass may have pulled a Membership the server created since this
    // component mounted (an accepted Invitation elsewhere); re-read so the
    // access list is never stale.
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
      class="members-toggle"
      aria-haspopup="dialog"
      popovertarget="members-panel"
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
        <ul class="member-names">
          <li v-for="member in members" :key="member.memberId">
            {{ member.memberId === session.user?.id ? `${member.name} (you)` : member.name }}
          </li>
        </ul>
        <template v-if="isOwner()">
          <h3>Invitations</h3>
          <p v-if="invitations.length === 0">Nobody invited yet.</p>
          <ul>
            <li
              v-for="invitation in invitations.filter((invite) => invite.status !== 'accepted')"
              :key="invitation.id"
            >
              {{ invitation.email }}
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
        <p v-if="error">{{ error }}</p>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.members-toggle {
  anchor-name: --members;
}

/* Popovers render in the top layer, so they position against the viewport, not
   the DOM parent. Anchor the panel to the button to drop it just below. */
.members-dialog {
  position: fixed;
  position-anchor: --members;
  inset: auto;
  top: anchor(--members bottom);
  left: anchor(--members left);
  margin: 0.25rem 0 0;
  width: max-content;
  max-width: min(24rem, calc(100vw - 2rem));
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  box-shadow: 0 4px 16px var(--color-shadow);
}

.members-dialog:focus {
  outline: none;
}

.members-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}

.member-names {
  list-style: none;
  padding: 0;
  margin: 0.25rem 0 0.75rem;
}
</style>
