<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { List } from "@shopping-list/api/domain";
import AppBar from "../components/AppBar.vue";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { createList } from "../lists";
import { listColors } from "../utils/listColors";
import { session } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { submit } from "../utils/submit";

const lists = ref<List[]>([]);
const name = ref("");
const error = ref<string | null>(null);
const creating = ref(false);

async function loadLists() {
  lists.value = await db.getLists();
}

function penStyle(list: List) {
  return { "--list-accent": listColors(list.id).accent };
}

async function onCreate() {
  error.value = null;
  const user = session.user;
  if (!user) {
    return;
  }
  const created = await submit({ error, busy: creating }, "Could not create the list", () =>
    createList(db, user.id, name.value),
  );
  if (!created) {
    return;
  }
  name.value = "";
  await logRejection(loadLists(), "Loading the lists");
}

let stopSyncPass: (() => void) | null = null;

onMounted(() => {
  // Paint the local state right away, then reconcile with the server.
  void logRejection(loadLists(), "Loading the lists");
  stopSyncPass = onSyncPass(async () => {
    // A pass may have pulled in Lists that only exist on the server.
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
  <AppBar title="Shopping Lists" settings />
  <main class="page">
    <section aria-label="Your lists">
      <p v-if="lists.length === 0" class="empty">No lists yet. Create the first one below.</p>
      <ul v-else class="rows">
        <li v-for="list in lists" :key="list.id" :style="penStyle(list)">
          <RouterLink :to="{ name: 'list', params: { listId: list.id } }">
            <span>{{ list.name }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
    <section aria-label="Create a list">
      <h2>Create a list</h2>
      <form @submit.prevent="onCreate">
        <label>
          List name
          <input v-model="name" name="name" />
        </label>
        <button type="submit" :disabled="creating || !session.user">Create list</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<style scoped>
ul > li {
  padding-inline: var(--space-4);
  border-bottom: 1px solid var(--color-rule);

  &:last-child {
    border-bottom: none;
  }

  /* The stripe: the List's marker pen, drawn down the edge of its row. */
  &::before {
    content: "";
    width: 0.375rem;
    height: 1.625rem;
    border-radius: var(--radius-sm);
    background-color: var(--list-accent);
  }

  a {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-3);
    min-height: 3.25rem;
    font-weight: 600;
    text-decoration: none;
  }

  a::after {
    content: "›";
    margin-inline-start: auto;
    color: var(--color-ink-muted);
    font-size: 1.25rem;
    line-height: 1;
  }
}
</style>
