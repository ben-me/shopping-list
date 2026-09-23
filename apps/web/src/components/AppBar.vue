<script setup lang="ts">
import { useRouter, type RouteLocationRaw } from "vue-router";
import { session, signOutAndRedirect } from "../session";

/**
 * The one chrome every screen wears: the current context on the left, the way
 * back when there is one, and the account actions on the right. The `title` is
 * the page's `h1`, so pages do not render their own heading.
 *
 * The `nav` slot adds a second row for screens with their own sections (the
 * List's Items / Payments tabs).
 */
defineProps<{
  title: string;
  back?: RouteLocationRaw;
  settings?: boolean;
}>();

const router = useRouter();

async function onSignOut() {
  await signOutAndRedirect(router);
}
</script>

<template>
  <header class="app-bar">
    <div class="bar">
      <RouterLink v-if="back" class="back" :to="back">← Lists</RouterLink>
      <h1 class="title">{{ title }}</h1>
      <nav v-if="session.user" class="actions" aria-label="Account">
        <RouterLink v-if="settings" :to="{ name: 'settings' }">Settings</RouterLink>
        <button type="button" @click="onSignOut">Sign out</button>
      </nav>
    </div>
    <nav v-if="$slots.nav" class="tabs" aria-label="Sections">
      <slot name="nav" />
    </nav>
  </header>
</template>

<style scoped>
.app-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--color-paper);
  border-bottom: 1px solid var(--color-ink);
}

.bar,
.tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  max-width: var(--sheet-width);
  margin-inline: auto;
  padding-inline: var(--space-4);
}

.bar {
  min-height: var(--bar-height);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-h3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.back {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-size);
  margin-inline-start: calc(var(--space-2) * -1);
  padding-inline: var(--space-2);
  color: var(--color-ink-muted);
  font-size: var(--fs-small);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.back:hover {
  color: var(--color-ink);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.actions a,
.actions button {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-size);
  padding-inline: 0;
  border: 0;
  background: none;
  color: var(--color-ink-muted);
  font-size: var(--fs-small);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.actions a:hover,
.actions button:hover:not(:disabled) {
  background: none;
  color: var(--color-ink);
  text-decoration: underline;
}
</style>
