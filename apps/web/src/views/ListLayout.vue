<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppBar from "../components/AppBar.vue";
import ListTabs from "../components/ListTabs.vue";
import { useLiveList } from "../composables/useLiveList";
import { listColors, type ListColors } from "../utils/listColors";

/**
 * The persistent List chrome: the List's name and section tabs in the app
 * bar, above one scrolling screen. Living in a layout route of its own means
 * the bar — and with it the sliding section underline — never remounts while
 * the List's screens (Items, Payments, Members) swap beneath it.
 *
 * The route record is reused when the user moves to another List, so the name
 * is read live from the Store rather than once on mount: only params change,
 * and a List that swapped underneath a fixed title would show the wrong name
 * and the wrong pen.
 *
 * `colors` is the pad's marker pen, set as custom properties on this root so
 * the whole screen — bars, tabs, and rows — draws in it. A List that is still
 * loading has no pen yet and falls back.
 */
const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const list = useLiveList(listId);
const colors = computed<ListColors | null>(() => (list.value ? listColors(list.value.id) : null));
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
/* The column that stacks the bars above the screen, giving way so the List
   screen itself keeps its height. */
div {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
}
</style>
