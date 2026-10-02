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
  /* A ruled ledger row, edge to edge, with the type inset from the sheet edge.
     A touch tighter than the other screens' rows: the label below brings its
     own padding-block. */
  padding: var(--space-1) var(--space-4);
  border-bottom: 1px solid var(--color-rule);

  &:last-child {
    border-bottom: none;
  }

  /* The whole row is the label for the checkbox beside it. */
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

  /* The box is drawn on the checkbox itself, so there is no copy of it laid
     over the top and nothing to keep out of the pointer's way. */
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

  /* The tick rides inside the box, hidden until the box is filled in the List's
     pen; the fallback is the original marker yellow. */
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

  /* The name trails the box inside the label. */
  label span {
    min-width: 0;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  /* Done: the row takes the pen's soft wash, the name goes quiet. */
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
