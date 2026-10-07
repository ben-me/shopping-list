<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { onSyncPass, online, startSyncWatcher } from "./connectivity";
import { db } from "./db";
import { refreshPendingInvitationCount } from "./pending-invitations";

// Sync quietly in the background for as long as the app is open: queued
// offline writes drain and remote state is pulled in whenever the connection
// returns.
let stopSyncWatcher: (() => void) | null = null;
// Global passes only: the badge is app-wide state the List screens never render.
let stopInviteCountRefresh: (() => void) | null = null;

onMounted(() => {
  stopSyncWatcher = startSyncWatcher(db);
  stopInviteCountRefresh = onSyncPass(refreshPendingInvitationCount, { globalOnly: true });
  // The badge should be right on first paint, not only after the first pass.
  void refreshPendingInvitationCount();
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
