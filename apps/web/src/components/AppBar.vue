<script setup lang="ts">
import { useRouter, type RouteLocationRaw } from "vue-router";
import { pendingInvitationCount } from "../pending-invitations";
import { session, signOutAndRedirect } from "../session";

/**
 * The one chrome every screen wears: the current context on the left, the way
 * back when there is one, and the account actions on the right. The `title` is
 * the page's `h1`, so pages do not render their own heading.
 *
 * The `nav` slot adds a second row for screens with their own sections (the
 * List's Items / Payments tabs).
 *
 * The Settings action carries a small count of pending Invitations when the
 * inbox is not empty — the number is kept fresh by the global Sync pass, so
 * this component only reads it.
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
        <RouterLink v-if="settings" :to="{ name: 'settings' }" class="settings-link">
          Settings
          <span v-if="pendingInvitationCount > 0" class="invite-badge" aria-hidden="true">
            {{ pendingInvitationCount }}
          </span>
          <span v-if="pendingInvitationCount > 0" class="visually-hidden">
            {{ pendingInvitationCount }} pending
            {{ pendingInvitationCount === 1 ? "invitation" : "invitations" }}
          </span>
        </RouterLink>
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

.settings-link {
  gap: 0.375rem;
}

/* The pending-invitation count: a small ink disc so it stays in the palette
   without borrowing the marker, which means "marked off" and nothing else. */
.invite-badge {
  display: inline-grid;
  place-items: center;
  min-width: 1.15rem;
  height: 1.15rem;
  padding-inline: 0.25rem;
  border-radius: 999px;
  background-color: var(--color-ink);
  color: var(--color-paper);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}

/* Text only a screen reader hears: the disc itself says just the number. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
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
