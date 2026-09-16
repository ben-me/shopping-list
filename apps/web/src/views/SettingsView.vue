<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { List, PendingInvitation } from "@shopping-list/api/domain";
import { apiFetch } from "../api";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { acceptInvitation, declineInvitation, pendingInvitations } from "../invitations";
import { leaveList } from "../members";
import { session, signOut } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const router = useRouter();
const invitations = ref<PendingInvitation[]>([]);
const inviteError = ref<string | null>(null);
const joinedLists = ref<List[]>([]);
const leavePending = ref<string | null>(null);
const leaveError = ref<string | null>(null);
const isAdmin = computed(() => session.user?.role === "admin");
const form = ref({
  name: "",
  email: "",
  password: "",
  error: null as string | null,
  submitting: false,
  createdName: null as string | null,
});

async function loadInvitations() {
  invitations.value = await pendingInvitations();
}

/** Lists the caller joined as a Member — their own Lists never appear here. */
async function loadJoinedLists() {
  const user = session.user;
  if (!user) {
    joinedLists.value = [];
    return;
  }
  const localLists = await db.getLists();
  const joined: List[] = [];
  for (const list of localLists) {
    if (list.ownerId === user.id) {
      continue;
    }
    const memberships = await db.getMemberships(list.id);
    if (memberships.some((membership) => membership.memberId === user.id)) {
      joined.push(list);
    }
  }
  joinedLists.value = joined;
}

/**
 * Accept makes the invitee a Member; a Sync pass then pulls the new List in,
 * so it appears on the Lists home without a reload. Decline closes the Invitation.
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
  await logRejection(loadInvitations(), "Loading the invitations");
}

async function onDecline(invitation: PendingInvitation) {
  inviteError.value = null;
  await logRejection(declineInvitation(invitation.id), "Declining the invitation");
  await logRejection(loadInvitations(), "Loading the invitations");
}

/**
 * Online-only, like accepting: the server drops the Membership first, then
 * the local List goes. The Lists home re-reads the Store on navigation, so
 * the left List is gone from there too.
 */
async function onLeave(list: List) {
  leaveError.value = null;
  leavePending.value = list.id;
  try {
    await leaveList(db, list.id);
  } catch (err) {
    leaveError.value = err instanceof Error ? err.message : "Could not leave the list";
    return;
  } finally {
    leavePending.value = null;
  }
  await logRejection(loadJoinedLists(), "Loading the joined lists");
}

/**
 * Only the Admin creates accounts (ADR 0003): this section is admin-only, and
 * the API route still rejects anyone else with a 403.
 */
async function addUser() {
  form.value.error = null;
  form.value.submitting = true;
  try {
    await apiFetch("/api/auth/admin/create-user", {
      method: "POST",
      body: {
        name: form.value.name,
        email: form.value.email,
        password: form.value.password,
        role: "user",
        data: { emailVerified: true },
      },
    });
  } catch (err) {
    form.value.error = err instanceof Error ? err.message : "Could not create the account";
    return;
  } finally {
    form.value.submitting = false;
  }
  form.value.createdName = form.value.name;
  form.value.name = "";
  form.value.email = "";
  form.value.password = "";
}

async function onSignOut() {
  await signOut();
  await router.push({ name: "sign-in" });
}

let stopSyncPass: (() => void) | null = null;

async function reloadAll() {
  await ignoreRejection(loadInvitations());
  await logRejection(loadJoinedLists(), "Loading the joined lists");
}

onMounted(() => {
  // Paint the local state right away, then reconcile with the server so the
  // joined Lists are fresh before they are offered for leaving.
  void logRejection(loadJoinedLists(), "Loading the joined lists");
  ignoreRejection(loadInvitations());
  stopSyncPass = onSyncPass(reloadAll);
  void ignoreRejection(runSyncPass(db));
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <h1>Settings</h1>
  <div v-if="session.user">
    <p>Signed in as {{ session.user.name }}</p>
    <RouterLink :to="{ name: 'lists' }">Back to lists</RouterLink>
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
  <section class="joined-lists" aria-label="Lists you joined">
    <h2>Lists you joined</h2>
    <p v-if="joinedLists.length === 0">You haven't joined any lists yet.</p>
    <ul>
      <li v-for="list in joinedLists" :key="list.id">
        {{ list.name }}
        <button
          type="button"
          name="leave-list"
          :disabled="leavePending === list.id"
          @click="onLeave(list)"
        >
          Leave
        </button>
      </li>
    </ul>
    <p v-if="leaveError">{{ leaveError }}</p>
  </section>
  <section v-if="isAdmin" class="add-user" aria-label="Add a user">
    <h2>Add a user</h2>
    <p>Give a new household member their name, email, and password.</p>
    <form class="add-user-form" @submit.prevent="addUser">
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
      <button type="submit" :disabled="form.submitting">Add user</button>
    </form>
    <p v-if="form.error">{{ form.error }}</p>
    <p v-if="form.createdName">{{ form.createdName }} can now sign in.</p>
  </section>
</template>
