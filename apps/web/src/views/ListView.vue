<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Item } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { addItem, removeItem, setItemChecked, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const items = ref<Item[]>([]);
const itemForm = ref({
  name: "",
  error: null as string | null,
});

async function loadItems() {
  items.value = await db.getItems(listId.value);
}

async function onAdd() {
  itemForm.value.error = null;
  try {
    await addItem(db, listId.value, itemForm.value.name);
  } catch (err) {
    itemForm.value.error = err instanceof Error ? err.message : "Could not add the item";
    return;
  }
  itemForm.value.name = "";
  await logRejection(loadItems(), "Loading the items");
  ignoreRejection(syncOutbox(db));
}

async function onToggle(item: Item, checked: boolean) {
  await logRejection(setItemChecked(db, item, checked), "Ticking the item");
  await logRejection(loadItems(), "Loading the items");
  ignoreRejection(syncOutbox(db));
}

async function onRemove(item: Item) {
  await logRejection(removeItem(db, item), "Removing the item");
  await logRejection(loadItems(), "Loading the items");
  ignoreRejection(syncOutbox(db));
}

let stopSyncPass: (() => void) | null = null;

onMounted(() => {
  logRejection(loadItems(), "Loading the items");
  stopSyncPass = onSyncPass(async (db) => {
    await ignoreRejection(syncItemsFromServer(db, listId.value));
    await logRejection(loadItems(), "Loading the items");
  });
  // A list-scoped pass: this screen drains the outbox and pulls its own
  // Items, but does not pull the app-wide Lists index or invitation inbox.
  void ignoreRejection(runSyncPass(db, "list"));
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <ListScreen>
    <template #entry>
      <form @submit.prevent="onAdd">
        <input
          v-model="itemForm.name"
          name="item"
          aria-label="Add an item"
          placeholder="Add an item"
          autocomplete="off"
          enterkeyhint="done"
        />
        <button type="submit">Add</button>
      </form>
      <p v-if="itemForm.error" class="error">{{ itemForm.error }}</p>
    </template>

    <p v-if="items.length === 0" class="empty">Nothing here yet.</p>
    <ul v-else class="rows">
      <li v-for="item in items" :key="item.id" :class="{ done: item.checked }">
        <label>
          <input
            type="checkbox"
            name="checked"
            :checked="item.checked"
            @change="onToggle(item, ($event.target as HTMLInputElement).checked)"
          />
          <span aria-hidden="true"></span>
          <span>{{ item.name }}</span>
        </label>
        <button type="button" :aria-label="`Remove ${item.name}`" @click="onRemove(item)">×</button>
      </li>
    </ul>
  </ListScreen>
</template>

<style scoped>
form input[name="item"] {
  flex: 1;
}

ul > li {
  padding-block: var(--space-1);

  /* The tick: the whole row is the label for the checkbox underneath it. */
  label {
    position: relative;
    display: flex;
    flex: 1;
    gap: var(--space-3);
    align-items: center;
    min-width: 0;
    min-height: var(--control-size);
    padding-block: var(--space-1);
    cursor: pointer;
  }

  label input {
    position: absolute;
    z-index: 1;
    inset-inline-start: 0;
    top: 50%;
    width: 1.4rem;
    height: 1.4rem;
    margin: 0;
    opacity: 0;
    transform: translateY(-50%);
  }

  /* The drawn box: the one decorative span, hidden from the screen reader. */
  label span[aria-hidden="true"] {
    display: grid;
    flex: none;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border: 2px solid var(--color-ink);
    border-radius: 3px;
    background-color: var(--color-paper);
    font-size: 0.85rem;
    font-weight: 800;
    line-height: 1;

    /* The tick is drawn in the pad's pen: this Item is done, marked off in the
       List's own colour. A pad without a pen yet falls back to the original
       marker yellow. */
    &::after {
      content: "✓";
      opacity: 0;
    }
  }

  /* The name trails the box inside the label. */
  label span:last-child {
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  label input:checked + span {
    background-color: var(--list-accent, var(--color-marker));
  }

  label input:checked + span::after {
    opacity: 1;
  }

  label input:focus-visible + span {
    outline: 2px solid var(--color-ink);
    outline-offset: 2px;
  }

  /* This Item is done: the row takes the pen's soft wash, the name goes quiet
     and struck through. */
  &.done {
    background-color: var(--list-accent-soft, var(--color-marker-soft));
  }

  &.done label span:last-child {
    color: var(--color-ink-muted);
    text-decoration: line-through;
    text-decoration-thickness: 2px;
  }

  button {
    flex: none;
    width: var(--control-size);
    min-height: var(--control-size);
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-ink-muted);
    font-size: 1.15rem;
  }

  button:hover:not(:disabled) {
    background: none;
    color: var(--color-owes);
  }
}
</style>
