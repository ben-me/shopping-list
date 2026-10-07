<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppBar from "../components/AppBar.vue";
import ListTabs from "../components/ListTabs.vue";
import { useDexieLiveData } from "../composables/useDexieLiveData";
import { db } from "../db";
import { listColors, type ListColors } from "../utils/listColors";

/**
 * The persistent List chrome: the List's name and tabs above the screen. The
 * route record is reused across Lists, so the name and pen are read live
 * rather than once on mount; a still-loading List falls back.
 */
const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const list = useDexieLiveData([listId], () => db.getList(listId.value), undefined);
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
