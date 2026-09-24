<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Item, List } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import { onSyncPass, runSyncPass } from "../connectivity";
import { currentList, loadList } from "../current-list";
import { db } from "../db";
import { addItem, removeItem, setItemChecked, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const list = ref<List | null>(currentList(listId.value));
const items = ref<Item[]>([]);
const itemForm = ref({
  name: "",
  error: null as string | null,
});

async function loadTheList() {
  list.value = await loadList(db, listId.value);
}

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
  logRejection(loadTheList(), "Loading the list");
  logRejection(loadItems(), "Loading the items");
  stopSyncPass = onSyncPass(async (db) => {
    await ignoreRejection(syncItemsFromServer(db, listId.value));
    await logRejection(loadTheList(), "Loading the list");
    await logRejection(loadItems(), "Loading the items");
  });
  void ignoreRejection(runSyncPass(db));
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <ListScreen :title="list?.name ?? 'List'" :list-id="listId">
    <template #entry>
      <form class="add-item-form" @submit.prevent="onAdd">
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
    <ul v-else class="rows item-list">
      <li v-for="item in items" :key="item.id" :class="{ done: item.checked }">
        <label class="tick">
          <input
            type="checkbox"
            name="checked"
            :checked="item.checked"
            @change="onToggle(item, ($event.target as HTMLInputElement).checked)"
          />
          <span class="box" aria-hidden="true"></span>
          <span class="name">{{ item.name }}</span>
        </label>
        <button
          type="button"
          class="remove"
          :aria-label="`Remove ${item.name}`"
          @click="onRemove(item)"
        >
          ×
        </button>
      </li>
    </ul>
  </ListScreen>
</template>

<style scoped>
.entry input[name="item"] {
  flex: 1;
}

.item-list > li {
  padding-block: var(--space-1);
}

.tick {
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

.tick input {
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

.box {
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
}

/* The tick is drawn in the marker: this Item is done. */
.box::after {
  content: "✓";
  opacity: 0;
}

.tick input:checked + .box {
  background-color: var(--color-marker);
}

.tick input:checked + .box::after {
  opacity: 1;
}

.tick input:focus-visible + .box {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}

.name {
  min-width: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.item-list > li.done {
  background-color: var(--color-marker-soft);
}

.item-list > li.done .name {
  color: var(--color-ink-muted);
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}

.remove {
  flex: none;
  width: var(--control-size);
  min-height: var(--control-size);
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-ink-muted);
  font-size: 1.15rem;
}

.remove:hover:not(:disabled) {
  background: none;
  color: var(--color-owes);
}
</style>
