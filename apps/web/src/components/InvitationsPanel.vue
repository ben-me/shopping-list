<script setup lang="ts">
import { computed } from "vue";
import type { ListInvitation } from "@shopping-list/api/domain";

/* The Owner's corner of the Members screen. The screen owns the data and the
   calls; this owns the wording and the layout. */
const props = defineProps<{
  /** Accepted ones included: the panel hides them, not the caller. */
  invitations: ListInvitation[];
  email: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  invite: [];
  "update:email": [email: string];
  revoke: [invitation: ListInvitation];
}>();

/** Invitations that can still be revoked; accepted ones are hidden here. */
const openInvitations = computed(() =>
  props.invitations.filter((invitation) => invitation.status !== "accepted"),
);

const statusLabel = (status: ListInvitation["status"]) =>
  status === "pending" ? "invited" : status === "accepted" ? "joined" : "closed";
</script>

<template>
  <section>
    <h2>Invitations</h2>
    <p v-if="invitations.length === 0" class="empty">Nobody invited yet.</p>
    <ul v-else>
      <li v-for="invitation in openInvitations" :key="invitation.id">
        <span>{{ invitation.email }}</span>
        <span class="invitation-status">({{ statusLabel(invitation.status) }})</span>
        <button
          v-if="invitation.status === 'pending'"
          type="button"
          name="revoke-invitation"
          :aria-label="`Revoke invitation for ${invitation.email}`"
          @click="emit('revoke', invitation)"
        >
          Revoke
        </button>
      </li>
    </ul>
    <form @submit.prevent="emit('invite')">
      <label>
        Email
        <input
          :value="email"
          name="invite-email"
          type="email"
          @input="emit('update:email', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <button type="submit" :disabled="submitting">Invite a member</button>
    </form>
  </section>
</template>

<style scoped>
/* One row each, revoke on the right edge. */
ul {
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-1);
    overflow-wrap: anywhere;
  }

  .invitation-status {
    color: var(--color-ink-muted);
  }

  button {
    margin-inline-start: auto;
    padding-inline: var(--space-2);
  }
}
</style>
