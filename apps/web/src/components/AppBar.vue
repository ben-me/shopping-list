<script setup lang="ts">
import { useRouter, type RouteLocationRaw } from "vue-router";
import { pendingInvitationCount } from "../pending-invitations";
import { session, signOutAndRedirect } from "../session";

/**
 * The chrome every screen wears. `title` is the page's `h1`; the `nav` slot
 * adds a second row holding the screen's own sections nav, which brings its
 * own landmark. The Settings count is kept fresh by the global Sync pass, so
 * this component only reads it.
 */
defineProps<{
  title: string;
  back?: RouteLocationRaw;
  settings?: boolean;
}>();

const router = useRouter();

/**
 * The pending count is drawn, not typed: the link hands its badge the number
 * as a custom property, quoted so `content` reads it as a string.
 */
function pendingStyle() {
  return pendingInvitationCount.value > 0
    ? { "--pending": `"${pendingInvitationCount.value}"` }
    : undefined;
}

async function onSignOut() {
  await signOutAndRedirect(router);
}
</script>

<template>
  <header>
    <div>
      <RouterLink v-if="back" :to="back" aria-label="Back">←</RouterLink>
      <h1>{{ title }}</h1>
      <nav v-if="session.user" aria-label="Account">
        <RouterLink v-if="settings" :to="{ name: 'settings' }" :style="pendingStyle()">
          Settings
          <span v-if="pendingInvitationCount > 0" class="visually-hidden">
            {{ pendingInvitationCount }} pending
            {{ pendingInvitationCount === 1 ? "invitation" : "invitations" }}
          </span>
        </RouterLink>
        <button type="button" @click="onSignOut">Sign out</button>
      </nav>
    </div>
    <!-- The screen's own second row: its sections. It brings its own nav, so
         nothing here wraps it in another one. -->
    <slot name="nav" />
  </header>
</template>

<style scoped>
header {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--color-paper);
  border-bottom: var(--hairline) solid var(--color-ink);

  > div {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    max-width: var(--sheet-width);
    min-height: var(--bar-height);
    margin-inline: auto;
    padding-inline: var(--space-4);

    /* Tighter together than the tabs. */
    nav {
      display: flex;
      align-items: center;
      gap: var(--space-3);

      a,
      button {
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

      /* The account link holds its label and count badge wide enough to
         breathe. */
      a {
        gap: 0.375rem;
      }

      a:hover,
      button:hover:not(:disabled) {
        background: none;
        color: var(--color-ink);
        text-decoration: underline;
      }

      /* The pending-invitation count, a small ink disc so it stays in the
         palette without borrowing the marker, which means "marked off" and
         nothing else. The link is handed the count as a custom property and
         leaves it unset when there is nothing pending. */
      a::after {
        content: var(--pending);
        display: inline-grid;
        place-items: center;
        min-width: var(--badge-size);
        height: var(--badge-size);
        padding-inline: var(--space-1);
        border-radius: var(--radius-pill);
        background-color: var(--color-ink);
        color: var(--color-paper);
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1;
      }
    }
  }

  h1 {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-h3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

a[aria-label="Back"] {
  display: inline-grid;
  place-items: center;
  min-height: var(--control-size);
  width: var(--control-size);
  margin-inline-start: calc(var(--space-2) * -1);
  color: var(--color-ink-muted);
  font-size: var(--fs-h3);
  font-weight: 600;
  line-height: 1;
  text-decoration: none;

  &:hover {
    color: var(--color-ink);
  }
}

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
</style>
