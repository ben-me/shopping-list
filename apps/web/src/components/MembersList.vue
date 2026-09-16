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
const dialogRef = ref<HTMLDialogElement | null>(null);

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

function openDialog() {
  // `show()` would do the same in browsers; the `open` attribute is the
  // non-modal dialog's own switch, and it works wherever `<dialog>` renders.
  dialogRef.value?.setAttribute("open", "");
}

function closeDialog() {
  dialogRef.value?.removeAttribute("open");
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
  dialogRef.value?.removeAttribute("open");
});
</script>

<template>
  <div class="members-list">
    <button type="button" class="members-toggle" @click="openDialog">Members</button>
    <dialog ref="dialogRef" class="members-dialog" aria-label="List members">
      <div class="members-panel">
        <button type="button" class="members-close" @click="closeDialog">Close</button>
        <h2>Members</h2>
        <ul class="member-names">
          <li v-for="member in members" :key="member.memberId">
            {{ member.memberId === session.user?.id ? `${member.name} (you)` : member.name }}
          </li>
        </ul>
        <template v-if="isOwner()">
          <h3>Invitations</h3>
          <p v-if="invitations.length === 0">Nobody invited yet.</p>
          <ul>
            <li v-for="invitation in invitations" :key="invitation.id">
              {{ invitation.email }} — invited by {{ invitation.invitedByName }}
              <span class="invitation-status">{{ statusLabel(invitation.status) }}</span>
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
.members-dialog {
  border: none;
  padding: 0;
  background: transparent;
  color: inherit;
}

/* Mobile: a card the toggle button reveals in the top layer (non-modal). */
.members-toggle {
  margin-bottom: 0.5rem;
}

.members-close {
  display: block;
  margin: 0 0 0.5rem auto;
}

.members-dialog:not([open]) {
  display: none;
}

/* Tablet and up: the panel renders inline, no dialog chrome. */
@media (min-width: 768px) {
  .members-toggle,
  .members-close {
    display: none;
  }

  .members-dialog:not([open]),
  .members-dialog[open] {
    display: block;
    position: static;
    inset: auto;
    width: auto;
    max-width: none;
    height: auto;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
  }

  .members-dialog::backdrop {
    display: none;
  }
}

.member-names {
  list-style: none;
  padding: 0;
  margin: 0.25rem 0 0.75rem;
}
</style>
