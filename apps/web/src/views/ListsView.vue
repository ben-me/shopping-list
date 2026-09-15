<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { List, PendingInvitation } from "@shopping-list/api/domain";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { acceptInvitation, declineInvitation, pendingInvitations } from "../invitations";
import { createList } from "../lists";
import { session, signOut } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const router = useRouter();
const lists = ref<List[]>([]);
const invitations = ref<PendingInvitation[]>([]);
const inviteError = ref<string | null>(null);
const name = ref("");
const error = ref<string | null>(null);
const creating = ref(false);
const isAdmin = computed(() => session.user?.role === "admin");

async function loadLists() {
  lists.value = await db.getLists();
}

async function loadInvitations() {
  invitations.value = await pendingInvitations();
}

/**
 * Accept makes the invitee a Member; a Sync pass then pulls the new List in,
 * so the Lists home shows it without a reload. Decline closes the Invitation.
 */
async function onAccept(invitation: PendingInvitation) {
  inviteError.value = null;
  try {
    await acceptInvitation(invitation.id);
  } catch (err) {
    inviteError.value = err instanceof Error ? err.message : "Could not accept the invitation";
    return;
  }
  // A member joined: pull the List down before the inbox refreshes, so the
  // accept is visible immediately even if a mount sync was already running.
  await logRejection(runSyncPass(db), "Syncing after accepting");
  await logRejection(loadLists(), "Loading the lists");
  await logRejection(loadInvitations(), "Loading the invitations");
}

async function onDecline(invitation: PendingInvitation) {
  inviteError.value = null;
  await logRejection(declineInvitation(invitation.id), "Declining the invitation");
  await logRejection(loadInvitations(), "Loading the invitations");
}

async function onCreate() {
  error.value = null;
  if (!session.user) {
    return;
  }
  creating.value = true;
  try {
    await createList(db, session.user.id, name.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not create the list";
    return;
  } finally {
    creating.value = false;
  }
  name.value = "";
  await logRejection(loadLists(), "Loading the lists");
}

async function onSignOut() {
  await signOut();
  await router.push({ name: "sign-in" });
}

let stopSyncPass: (() => void) | null = null;

onMounted(() => {
  // Paint the local state right away, then reconcile with the server.
  void logRejection(loadLists(), "Loading the lists");
  ignoreRejection(loadInvitations());
  stopSyncPass = onSyncPass(async () => {
    // A sync pass may have pulled in Lists that appeared only on the server
    // since this view mounted — e.g. an accepted invitation or a device
    // hand-over where sign-in wiped the local Store. Re-read so the home is
    // never stale.
    await logRejection(loadLists(), "Loading the lists");
    await ignoreRejection(loadInvitations());
  });
  void ignoreRejection(runSyncPass(db));
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <h1>Shopping Lists</h1>
  <div v-if="session.user">
    <p>Signed in as {{ session.user.name }}</p>
    <RouterLink v-if="isAdmin" :to="{ name: 'settings' }">Settings</RouterLink>
    <button type="button" @click="onSignOut">Sign out</button>
  </div>
  <section v-if="invitations.length > 0" class="invitations" aria-label="Invitations for you">
    <h2>Invitations</h2>
    <ul>
      <li v-for="invitation in invitations" :key="invitation.id">
        {{ invitation.invitedByName }} invited you to {{ invitation.listName }}
        <button type="button" name="accept-invitation" @click="onAccept(invitation)">Accept</button>
        <button type="button" name="decline-invitation" @click="onDecline(invitation)">
          Decline
        </button>
      </li>
    </ul>
    <p v-if="inviteError">{{ inviteError }}</p>
  </section>
  <p v-if="lists.length === 0">Your lists will appear here.</p>
  <ul>
    <li v-for="list in lists" :key="list.id">
      <RouterLink :to="{ name: 'list', params: { listId: list.id } }">{{ list.name }}</RouterLink>
    </li>
  </ul>
  <form @submit.prevent="onCreate">
    <label>
      List name
      <input v-model="name" name="name" />
    </label>
    <button type="submit" :disabled="creating || !session.user">Create a List</button>
  </form>
  <p v-if="error">{{ error }}</p>
</template>
