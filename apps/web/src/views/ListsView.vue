<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { List } from "@shopping-list/api/domain";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { createList } from "../lists";
import { session, signOut } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const router = useRouter();
const lists = ref<List[]>([]);
const name = ref("");
const error = ref<string | null>(null);
const creating = ref(false);

async function loadLists() {
  lists.value = await db.getLists();
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
  await router.push({ name: "sign-in" });
  await signOut();
}

let stopSyncPass: (() => void) | null = null;

onMounted(() => {
  // Paint the local state right away, then reconcile with the server.
  void logRejection(loadLists(), "Loading the lists");
  stopSyncPass = onSyncPass(async () => {
    // A sync pass may have pulled in Lists that appeared only on the server
    // since this view mounted — e.g. an accepted invitation or a device
    // hand-over where sign-in wiped the local Store. Re-read so the home is
    // never stale.
    await logRejection(loadLists(), "Loading the lists");
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
    <RouterLink :to="{ name: 'settings' }">Settings</RouterLink>
    <button type="button" @click="onSignOut">Sign out</button>
  </div>
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
