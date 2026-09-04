<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Item } from "@shopping-list/api/domain";
import { db } from "../db";
import { addItem, removeItem, setItemChecked, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const listName = ref<string | null>(null);
const items = ref<Item[]>([]);
const name = ref("");
const error = ref<string | null>(null);

async function loadList() {
  const list = await db.getList(listId.value);
  listName.value = list?.name ?? null;
}

async function loadItems() {
  items.value = await db.getItems(listId.value);
}

async function onAdd() {
  error.value = null;
  try {
    await addItem(db, listId.value, name.value);
    name.value = "";
    await loadItems();
    void syncOutbox(db).catch(() => undefined);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not add the item";
  }
}

async function onToggle(item: Item, checked: boolean) {
  await setItemChecked(db, item, checked);
  await loadItems();
  // While online, flush the queued write right away so a quick reload (or a
  // lost page) cannot drop it. Offline the drain fails harmlessly and the
  // entry is retried on the next mount.
  void syncOutbox(db).catch(() => undefined);
}

async function onRemove(item: Item) {
  await removeItem(db, item);
  await loadItems();
  void syncOutbox(db).catch(() => undefined);
}

onMounted(() => {
  void loadList();
  void loadItems();
  // Drain the outbox BEFORE pulling the server's Items: any writes still
  // queued from an earlier session (e.g. an in-flight sync killed by a
  // reload) must reach the server first, otherwise the pull overwrites the
  // local state they describe and the change is lost. Once the queue is
  // flushed, the server is authoritative and wins.
  void (async () => {
    await syncOutbox(db).catch(() => undefined);
    await syncItemsFromServer(db, listId.value).catch(() => undefined);
    await loadItems();
  })();
});
</script>

<template>
  <h1>{{ listName ?? "List" }}</h1>
  <p v-if="items.length === 0" data-testid="no-items">Nothing on this list yet.</p>
  <ul>
    <li v-for="item in items" :key="item.id">
      <label>
        <input
          type="checkbox"
          data-testid="item-checkbox"
          :checked="item.checked"
          @change="onToggle(item, ($event.target as HTMLInputElement).checked)"
        />
        <span data-testid="item-name" :class="{ bought: item.checked }">{{ item.name }}</span>
      </label>
      <button type="button" data-testid="remove-item" @click="onRemove(item)">Remove</button>
    </li>
  </ul>
  <form data-testid="add-item" @submit.prevent="onAdd">
    <label>
      Item name
      <input v-model="name" data-testid="item-name-input" />
    </label>
    <button type="submit">Add an Item</button>
  </form>
  <p v-if="error" data-testid="add-item-error">{{ error }}</p>
</template>