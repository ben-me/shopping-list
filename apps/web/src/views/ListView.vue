<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useDraggable, type DraggableEvent } from "vue-draggable-plus";
import type { Item } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import { runSyncPass, useSyncPass } from "../connectivity";
import { useDexieLiveData } from "../composables/useDexieLiveData";
import { db } from "../db";
import { addItem, removeItem, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { submit } from "../utils/submit";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const items = useDexieLiveData([listId], () => db.getItems(listId.value), []);
const itemForm = ref({
  name: "",
});
const itemError = ref<string | null>(null);
const rows = ref<HTMLElement | null>(null);

useDraggable(rows, items, {
  animation: 150,
  delay: 250,
  delayOnTouchOnly: true,
  touchStartThreshold: 5,
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 4,
  filter: "button",
  preventOnFilter: false,
  onUpdate: onReorder,
});

function onReorder(event: DraggableEvent<Item>) {
  const index = event.newDraggableIndex ?? event.newIndex;
  if (index === undefined) {
    return;
  }
  logRejection(
    db.moveItem(listId.value, event.data.id, index).then(() => ignoreRejection(syncOutbox(db))),
    "Reordering the items",
  );
}

async function onAdd() {
  const added = await submit({ error: itemError }, "Could not add the item", () =>
    addItem(db, listId.value, itemForm.value.name),
  );
  if (!added) {
    return;
  }
  itemForm.value.name = "";
  ignoreRejection(syncOutbox(db));
}

// The box has already flipped; a failed write leaves the database unchanged, so put it back by hand.
function onToggle(item: Item, event: Event) {
  const input = event.target as HTMLInputElement;
  ignoreRejection(
    db.setItemChecked(item.id, item.listId, input.checked).then(
      () => ignoreRejection(syncOutbox(db)),
      async (err: unknown) => {
        console.error("Ticking the item failed", err);
        return db.getItem(item.id).then((stored) => {
          input.checked = stored?.checked ?? false;
        });
      },
    ),
  );
}

function onRemove(item: Item) {
  logRejection(
    removeItem(db, item).then(() => ignoreRejection(syncOutbox(db))),
    "Removing the item",
  );
}

useSyncPass(async (db) => {
  await ignoreRejection(syncItemsFromServer(db, listId.value));
});

// useSyncPass registers its handler in an onMounted hook, so it must come first.
onMounted(() => {
  void ignoreRejection(runSyncPass(db, "list"));
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
      <p v-if="itemError" class="error">{{ itemError }}</p>
    </template>

    <p v-if="items.length === 0" class="empty">Nothing here yet.</p>
    <ul ref="rows" class="rows">
      <li v-for="item in items" :key="item.id" class="item" :class="{ done: item.checked }">
        <label>
          <input
            type="checkbox"
            name="checked"
            :checked="item.checked"
            @change="onToggle(item, $event)"
          />
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

ul.rows {
  user-select: none;
  -webkit-touch-callout: none;
}

.item.sortable-ghost {
  visibility: hidden;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4);
  border-bottom: 1px solid var(--color-rule);
  background-color: var(--color-paper);
  list-style: none;

  &:last-child {
    border-bottom: none;
  }

  label {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: var(--space-3);
    flex: 1;
    min-width: 0;
    min-height: var(--control-size);
    padding-block: var(--space-1);
    cursor: pointer;
  }

  label input {
    display: grid;
    place-items: center;
    width: var(--checkbox-size);
    height: var(--checkbox-size);
    appearance: none;
    border: 2px solid var(--color-ink);
    border-radius: var(--radius-sm);
    background-color: var(--color-paper);
  }

  label input::after {
    content: "✓";
    opacity: 0;
    font-size: 0.85rem;
    font-weight: 800;
    line-height: 1;
  }

  label input:checked {
    background-color: var(--list-accent, var(--color-marker));
  }

  label input:checked::after {
    opacity: 1;
  }

  label span {
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  &.done {
    background-color: var(--list-accent-soft, var(--color-marker-soft));
  }

  &.done label span {
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
