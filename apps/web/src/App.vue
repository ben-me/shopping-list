<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { onSyncPass, online, startSyncWatcher } from "./connectivity";
import { useKeyboardInset } from "./composables/useKeyboardInset";
import { db } from "./db";
import { refreshPendingInvitationCount } from "./pending-invitations";

useKeyboardInset();

// Sync quietly in the background for as long as the app is open: queued
// offline writes drain and remote state is pulled in whenever the connection
// returns.
let stopSyncWatcher: (() => void) | null = null;
// Global passes only: the badge is app-wide state the List screens never render.
let stopInviteCountRefresh: (() => void) | null = null;

onMounted(() => {
  stopSyncWatcher = startSyncWatcher(db);
  // Registered before the screen's mount pass reaches the server, which is
  // where the badge's first read comes from: no separate read on startup.
  stopInviteCountRefresh = onSyncPass((_db, reads) => refreshPendingInvitationCount(reads), {
    globalOnly: true,
  });
});

onUnmounted(() => {
  stopSyncWatcher?.();
  stopSyncWatcher = null;
  stopInviteCountRefresh?.();
  stopInviteCountRefresh = null;
});
</script>

<template>
  <p v-if="!online" role="status">Offline — your changes will sync when you reconnect</p>
  <RouterView />
</template>

<style scoped>
p {
  flex: none;
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-ink);
  color: var(--color-paper);
  font-size: var(--fs-small);
  font-weight: 600;
  text-align: center;
}
</style>
