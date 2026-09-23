<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { online, startSyncWatcher } from "./connectivity";
import { db } from "./db";

// Sync silently in the background for as long as the app is open: queued
// offline writes drain and remote state is pulled in whenever the connection
// returns — no user action, no error surface.
let stopSyncWatcher: (() => void) | null = null;

onMounted(() => {
  stopSyncWatcher = startSyncWatcher(db);
});

onUnmounted(() => {
  stopSyncWatcher?.();
  stopSyncWatcher = null;
});
</script>

<template>
  <p v-if="!online" role="status" class="offline">
    Offline — your changes will sync when you reconnect
  </p>
  <RouterView />
</template>

<style scoped>
.offline {
  flex: none;
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-ink);
  color: var(--color-paper);
  font-size: var(--fs-small);
  font-weight: 600;
  text-align: center;
}
</style>
