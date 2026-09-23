<script setup lang="ts">
import { useRouter, type RouteLocationRaw } from "vue-router";
import { session, signOutAndRedirect } from "../session";

/**
 * The one chrome every screen wears: the current context on the left, the way
 * back when there is one, and the account actions on the right. The `title` is
 * the page's `h1`, so pages do not render their own heading.
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
    <div class="app-bar-inner">
      <RouterLink v-if="back" class="back" :to="back">← Lists</RouterLink>
      <h1 class="title">{{ title }}</h1>
      <nav v-if="session.user" class="actions" aria-label="Account">
        <RouterLink v-if="settings" class="settings" :to="{ name: 'settings' }"
          >Settings</RouterLink
        >
        <button type="button" @click="onSignOut">Sign out</button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.app-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.app-bar-inner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: var(--content-width);
  min-height: var(--bar-height);
  margin-inline: auto;
  padding-inline: var(--space-4);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-h3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.back,
.settings {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-size);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.back {
  margin-inline-start: calc(var(--space-2) * -1);
  padding-inline: var(--space-2);
  color: var(--color-primary);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.actions a,
.actions button {
  min-height: var(--control-size);
  padding-inline: var(--space-3);
  white-space: nowrap;
}

.settings {
  color: var(--color-text);
}
</style>
