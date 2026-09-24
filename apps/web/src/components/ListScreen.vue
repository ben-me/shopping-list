<script setup lang="ts">
import AppBar from "./AppBar.vue";
import ListTabs from "./ListTabs.vue";

/**
 * A List screen: the List's name and sections in the app bar, an entry bar
 * pinned under it, and one scrolling sheet of rows beneath. The `entry` slot
 * holds the field that adds to the screen; the default slot holds the rows.
 */
defineProps<{ title: string; listId: string }>();
</script>

<template>
  <div class="screen">
    <AppBar :title="title" :back="{ name: 'lists' }">
      <template #nav>
        <ListTabs :list-id="listId" />
      </template>
    </AppBar>
    <div class="entry">
      <slot name="entry" />
    </div>
    <main class="page">
      <slot />
    </main>
  </div>
</template>
