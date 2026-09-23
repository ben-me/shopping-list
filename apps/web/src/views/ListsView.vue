<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { List } from "@shopping-list/api/domain";
import AppBar from "../components/AppBar.vue";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { createList } from "../lists";
import { session } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

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
  <AppBar title="Shopping Lists" settings />
  <main class="page">
    <p v-if="session.user" class="muted">Signed in as {{ session.user.name }}</p>
    <section class="lists" aria-label="Your lists">
      <p v-if="lists.length === 0" class="empty">No lists yet. Create the first one below.</p>
      <ul v-else class="rows list-index">
        <li v-for="list in lists" :key="list.id">
          <RouterLink :to="{ name: 'list', params: { listId: list.id } }">
            <span>{{ list.name }}</span>
            <span class="chevron" aria-hidden="true">›</span>
          </RouterLink>
        </li>
      </ul>
    </section>
    <section class="new-list" aria-label="Create a list">
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
.list-index > li {
  padding-block: 0;
}

.list-index a {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-3);
  min-height: 3.25rem;
  font-weight: 600;
  text-decoration: none;
}

.chevron {
  margin-inline-start: auto;
  color: var(--color-ink-muted);
  font-size: 1.25rem;
  line-height: 1;
}
</style>
