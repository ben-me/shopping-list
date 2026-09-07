<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import type { Item } from "@shopping-list/api/domain";
import { db } from "../db";
import { addItem, removeItem, setItemChecked, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const listName = ref<string | null>(null);
const items = ref<Item[]>([]);
const form = reactive({
  name: "",
  error: null as string | null,
});

async function loadList() {
  const list = await db.getList(listId.value);
  listName.value = list?.name ?? null;
}

async function loadItems() {
  items.value = await db.getItems(listId.value);
}

async function onAdd() {
  form.error = null;
  try {
    await addItem(db, listId.value, form.name);
    form.name = "";
    // logRejection never rejects, so a reload failure cannot be misreported
    // here as "could not add the item".
    await logRejection(loadItems(), "Loading the items");
    void ignoreRejection(syncOutbox(db));
  } catch (err) {
    form.error = err instanceof Error ? err.message : "Could not add the item";
  }
}

async function onToggle(item: Item, checked: boolean) {
  await logRejection(setItemChecked(db, item, checked), "Ticking the item");
  await logRejection(loadItems(), "Loading the items");
  // While online, flush the queued write right away so a quick reload (or a
  // lost page) cannot drop it. Offline the drain fails harmlessly and the
  // entry is retried on the next mount.
  void ignoreRejection(syncOutbox(db));
}

async function onRemove(item: Item) {
  await logRejection(removeItem(db, item), "Removing the item");
  await logRejection(loadItems(), "Loading the items");
  void ignoreRejection(syncOutbox(db));
}

onMounted(() => {
  // Paint the local state right away, then reconcile with the server.
  void logRejection(loadList(), "Loading the list");
  void logRejection(loadItems(), "Loading the items");
  // Drain the outbox BEFORE pulling the server's Items: any writes still
  // queued from an earlier session (e.g. an in-flight sync killed by a
  // reload) must reach the server first, otherwise the pull overwrites the
  // local state they describe and the change is lost. Once the queue is
  // flushed, the server is authoritative and wins.
  void (async () => {
    await ignoreRejection(syncOutbox(db));
    await ignoreRejection(syncItemsFromServer(db, listId.value));
    await logRejection(loadItems(), "Loading the items");
  })();
});
</script>

<template>
  <h1>{{ listName ?? "List" }}</h1>
  <p v-if="items.length === 0">Nothing on this list yet.</p>
  <ul>
    <li v-for="item in items" :key="item.id">
      <label>
        <input
          type="checkbox"
          name="checked"
          :checked="item.checked"
          @change="onToggle(item, ($event.target as HTMLInputElement).checked)"
        />
        <span :class="{ bought: item.checked }">{{ item.name }}</span>
      </label>
      <button type="button" @click="onRemove(item)">Remove</button>
    </li>
  </ul>
  <form @submit.prevent="onAdd">
    <label>
      Item name
      <input v-model="form.name" name="item" />
    </label>
    <button type="submit">Add an Item</button>
  </form>
  <p v-if="form.error">{{ form.error }}</p>
</template>
