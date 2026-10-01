<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Item } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import { runSyncPass, useSyncPass } from "../connectivity";
import { useLiveItems } from "../composables/useLiveItems";
import { db } from "../db";
import { addItem, removeItem, syncItemsFromServer } from "../items";
import { syncOutbox } from "../lists";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { submit } from "../utils/submit";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const items = useLiveItems(listId);
const itemForm = ref({
  name: "",
});
const itemError = ref<string | null>(null);

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

/**
 * The tick box has already flipped by the time this runs, so the new state is
 * read from the input - `item` still holds the old one. Not awaited: the live
 * query redraws the row when the write lands. A failed write leaves the
 * database unchanged, so the box is put back by hand, since nothing would
 * redraw it.
 */
function onToggle(item: Item, event: Event) {
  const input = event.target as HTMLInputElement;
  ignoreRejection(
    db.setItemChecked(item.id, item.listId, input.checked).then(
      () => ignoreRejection(syncOutbox(db)),
      (err: unknown) => {
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

// Registered before this, so the pass below pulls this screen's Items too.
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
    <ul v-else class="rows">
      <li v-for="item in items" :key="item.id" :class="{ done: item.checked }">
        <label>
          <input
            type="checkbox"
            name="checked"
            :checked="item.checked"
            @change="onToggle(item, $event)"
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

  /* The whole row is the label for the checkbox under it. The real checkbox
     shares a cell with the box drawn over it, so the grid does the placing and
     nothing needs an offset or z-index to stay in step with the row. */
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

  /* Both halves share one cell, and neither may grow the label's column. */
  label input,
  label span[aria-hidden="true"] {
    grid-area: 1 / 1;
    width: var(--checkbox-size);
    height: var(--checkbox-size);
  }

  label input {
    opacity: 0;
  }

  /* The drawn box: the one decorative span, hidden from the screen reader.
     It shares a cell with the real checkbox, so it stays out of the way of
     pointer events entirely — the label behind it is the click target. */
  label span[aria-hidden="true"] {
    display: grid;
    place-items: center;
    border: 2px solid var(--color-ink);
    border-radius: var(--radius-sm);
    background-color: var(--color-paper);
    font-size: 0.85rem;
    font-weight: 800;
    line-height: 1;
    pointer-events: none;
  }

  /* The tick, in the List's pen; the fallback is the original marker yellow. */
  label span[aria-hidden="true"]::after {
    content: "✓";
    opacity: 0;
  }

  /* The name trails the box inside the label. */
  label span:last-child {
    grid-area: 1 / 2;
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

  /* Done: the row takes the pen's soft wash, the name goes quiet. */
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
