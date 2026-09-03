<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { List } from "@shopping-list/api/domain";
import { db } from "../db";
import { createList, syncFromServer, syncOutbox } from "../lists";
import { session, signOut } from "../session";

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
    name.value = "";
    await loadLists();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not create the list";
  } finally {
    creating.value = false;
  }
}

async function onSignOut() {
  await signOut();
  await router.push({ name: "sign-in" });
}

onMounted(() => {
  void loadLists();
  void syncFromServer(db).catch(() => undefined);
  void syncOutbox(db).catch(() => undefined);
});
</script>

<template>
  <h1>Shopping Lists</h1>
  <div v-if="session.user">
    <p data-testid="signed-in-as">Signed in as {{ session.user.name }}</p>
    <button type="button" data-testid="sign-out" @click="onSignOut">Sign out</button>
  </div>
  <p v-if="lists.length === 0" data-testid="empty">Your lists will appear here.</p>
  <ul>
    <li v-for="list in lists" :key="list.id">
      <RouterLink :to="{ name: 'list', params: { listId: list.id } }">{{ list.name }}</RouterLink>
    </li>
  </ul>
  <form @submit.prevent="onCreate">
    <label>
      List name
      <input v-model="name" data-testid="list-name" />
    </label>
    <button type="submit" :disabled="creating || !session.user">Create a List</button>
  </form>
  <p v-if="error" data-testid="create-error">{{ error }}</p>
</template>
