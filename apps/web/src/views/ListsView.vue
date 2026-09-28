<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { List } from "@shopping-list/api/domain";
import AppBar from "../components/AppBar.vue";
import { onSyncPass, runSyncPass } from "../connectivity";
import { rememberLists } from "../current-list";
import { db } from "../db";
import { createList } from "../lists";
import { listColors } from "../utils/listColors";
import { session } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const lists = ref<List[]>([]);
const name = ref("");
const error = ref<string | null>(null);
const creating = ref(false);

async function loadLists() {
  lists.value = await db.getLists();
  // Hand the names to the List screens, which paint their app bar from there
  // rather than flashing an empty title while the Store read is in flight.
  rememberLists(lists.value);
}

function penStyle(list: List) {
  return { "--list-accent": listColors(list.id).accent };
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
    <section aria-label="Your lists">
      <p v-if="lists.length === 0" class="empty">No lists yet. Create the first one below.</p>
      <ul v-else class="rows">
        <li v-for="list in lists" :key="list.id" :style="penStyle(list)">
          <RouterLink :to="{ name: 'list', params: { listId: list.id } }">
            <span>{{ list.name }}</span>
            <span aria-hidden="true">›</span>
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
ul > li {
  padding-block: 0;

  /* The stripe: the List's marker pen, drawn down the edge of its row. */
  &::before {
    content: "";
    width: 0.375rem;
    height: 1.625rem;
    border-radius: 2px;
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

  /* The chevron: the link's decorative span, hidden from the screen reader. */
  a span[aria-hidden="true"] {
    margin-inline-start: auto;
    color: var(--color-ink-muted);
    font-size: 1.25rem;
    line-height: 1;
  }
}
</style>
