<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { onSyncPass, online, startSyncWatcher } from "./connectivity";
import { db } from "./db";
import { refreshPendingInvitationCount } from "./pending-invitations";

// Sync silently in the background for as long as the app is open: queued
// offline writes drain and remote state is pulled in whenever the connection
// returns — no user action, no error surface.
let stopSyncWatcher: (() => void) | null = null;
// Invitations only ever arrive from the server, so every Sync pass is the
// moment the Settings badge can learn about a new one. Runs alongside the
// per-view syncs; never blocks them.
let stopInviteCountRefresh: (() => void) | null = null;

onMounted(() => {
  stopSyncWatcher = startSyncWatcher(db);
  stopInviteCountRefresh = onSyncPass(refreshPendingInvitationCount);
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
