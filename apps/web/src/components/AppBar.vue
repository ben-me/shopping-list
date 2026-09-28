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
  <header>
    <div>
      <RouterLink v-if="back" :to="back" aria-label="Back">←</RouterLink>
      <h1>{{ title }}</h1>
      <nav v-if="session.user" aria-label="Account">
        <RouterLink v-if="settings" :to="{ name: 'settings' }">
          Settings
          <span v-if="pendingInvitationCount > 0" aria-hidden="true">
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
header {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--color-paper);
  border-bottom: 1px solid var(--color-ink);

  /* Both rows — the account line and the section tabs — ride on the same sheet
     and inset. */
  > div,
  > nav {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    max-width: var(--sheet-width);
    margin-inline: auto;
    padding-inline: var(--space-4);
  }

  h1 {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-h3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > div {
    min-height: var(--bar-height);

    /* The way back: the one link that is a direct child of the account line. */
    > a {
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

    /* The account actions sit tighter together than the tabs. */
    > nav {
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

      /* The pending-invitation count: a small ink disc so it stays in the
         palette without borrowing the marker, which means "marked off" and
         nothing else. */
      span[aria-hidden="true"] {
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
    }
  }
}
</style>
