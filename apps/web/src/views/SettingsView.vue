<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { PendingInvitation } from "@shopping-list/api/domain";
import { apiFetch } from "../api";
import AppBar from "../components/AppBar.vue";
import { runSyncPass, useSyncPass } from "../connectivity";
import { db } from "../db";
import { acceptInvitation, declineInvitation } from "../invitations";
import { loadPendingInvitations } from "../pending-invitations";
import { session } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { submit } from "../utils/submit";

const invitations = ref<PendingInvitation[]>([]);
const inviteError = ref<string | null>(null);
const isAdmin = computed(() => session.user?.role === "admin");
const form = ref({
  name: "",
  email: "",
  password: "",
  createdName: null as string | null,
});
const formError = ref<string | null>(null);
const formPending = ref(false);

/* The badge reads this same inbox count, which only this read writes. */
async function loadInvitations() {
  invitations.value = await loadPendingInvitations();
}

/* Accept makes the invitee a Member; the Sync pass then pulls the new List in. */
async function onAccept(invitation: PendingInvitation) {
  const accepted = await submit({ error: inviteError }, "Could not accept the invitation", () =>
    acceptInvitation(invitation.id),
  );
  if (!accepted) {
    return;
  }
  // Pull the List down before the inbox, so the accept shows at once even if a
  // mount sync was already running.
  await logRejection(runSyncPass(db), "Syncing after accepting");
  await logRejection(loadInvitations(), "Loading the invitations");
}

async function onDecline(invitation: PendingInvitation) {
  inviteError.value = null;
  await logRejection(declineInvitation(invitation.id), "Declining the invitation");
  await logRejection(loadInvitations(), "Loading the invitations");
}

/* Admin-only (ADR 0003); the API rejects anyone else with a 403. */
async function addUser() {
  const created = await submit(
    { error: formError, busy: formPending },
    "Could not create the account",
    () =>
      apiFetch("/api/auth/admin/create-user", {
        method: "POST",
        body: {
          name: form.value.name,
          email: form.value.email,
          password: form.value.password,
          role: "user",
          data: { emailVerified: true },
        },
      }),
  );
  if (!created) {
    return;
  }
  form.value.createdName = form.value.name;
  form.value.name = "";
  form.value.email = "";
  form.value.password = "";
}

async function reloadAll() {
  await ignoreRejection(loadInvitations());
}

useSyncPass(reloadAll);

onMounted(() => {
  // Paint local state first, then reconcile with the server.
  ignoreRejection(loadInvitations());
  void ignoreRejection(runSyncPass(db));
});
</script>

<template>
  <AppBar title="Settings" :back="{ name: 'lists' }" />
  <main class="page">
    <p v-if="session.user" class="muted">Signed in as {{ session.user.name }}</p>
    <section v-if="invitations.length > 0" aria-label="Invitations for you">
      <h2>Invitations</h2>
      <ul>
        <li v-for="invitation in invitations" :key="invitation.id">
          <p>{{ invitation.invitedByName }} invited you to {{ invitation.listName }}</p>
          <div>
            <button
              type="button"
              class="primary"
              name="accept-invitation"
              @click="onAccept(invitation)"
            >
              Accept
            </button>
            <button type="button" name="decline-invitation" @click="onDecline(invitation)">
              Decline
            </button>
          </div>
        </li>
      </ul>
      <p v-if="inviteError" class="error">{{ inviteError }}</p>
    </section>
    <section v-if="isAdmin" aria-label="Add a user">
      <h2>Add a user</h2>
      <p>Give a new household member their name, email, and password.</p>
      <form @submit.prevent="addUser">
        <label>
          Name
          <input v-model="form.name" name="add-user-name" />
        </label>
        <label>
          Email
          <input v-model="form.email" name="add-user-email" type="email" />
        </label>
        <label>
          Password
          <input
            v-model="form.password"
            name="add-user-password"
            type="password"
            autocomplete="new-password"
          />
        </label>
        <button type="submit" :disabled="formPending">Add user</button>
      </form>
      <p v-if="formError" class="error">{{ formError }}</p>
      <p v-if="form.createdName">{{ form.createdName }} can now sign in.</p>
    </section>
  </main>
</template>

<style scoped>
ul li {
  display: grid;
  gap: var(--space-2);
  padding-block: var(--space-3);
  border-bottom: var(--hairline) solid var(--color-rule);

  &:last-child {
    border-bottom: none;
  }

  /* Accept / Decline ride under the invitation's text, sharing its width. */
  div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  div button {
    flex: 1;
  }
}
</style>
