<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { List } from "@shopping-list/api/domain";
import AppBar from "../components/AppBar.vue";
import ListTabs from "../components/ListTabs.vue";
import { currentList, loadList } from "../current-list";
import { db } from "../db";
import { listColors, type ListColors } from "../utils/listColors";

/**
 * The persistent List chrome: the List's name and section tabs in the app
 * bar, above one scrolling screen. Living in a layout route of its own means
 * the bar — and with it the sliding section underline — never remounts while
 * the List's screens (Items, Payments, Members) swap beneath it.
 *
 * `colors` is the pad's marker pen, set as custom properties on this root so
 * the whole screen — bars, tabs, and rows — draws in it. A List that is still
 * loading has no pen yet and falls back.
 */
const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const list = ref<List | null>(currentList(listId.value));
const colors = computed<ListColors | null>(() => (list.value ? listColors(list.value.id) : null));

onMounted(() => {
  void loadList(db, listId.value).then((loaded) => {
    if (loaded) {
      list.value = loaded;
    }
  });
});
</script>

<template>
  <div
    :style="
      colors ? { '--list-accent': colors.accent, '--list-accent-soft': colors.soft } : undefined
    "
  >
    <AppBar :title="list?.name ?? 'List'" :back="{ name: 'lists' }">
      <template #nav>
        <ListTabs :list-id="listId" />
      </template>
    </AppBar>
    <RouterView />
  </div>
</template>

<style scoped>
/* The only element of the layout: the column that stacks the bars above the
   screen, able to give way so the List screen itself keeps its height. */
div {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
}
</style>
