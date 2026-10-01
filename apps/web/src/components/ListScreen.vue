<template>
  <div class="screen">
    <div v-if="$slots.entry" class="entry">
      <slot name="entry" />
    </div>
    <main class="page">
      <slot />
    </main>
    <footer v-if="$slots.footer" class="screen-footer">
      <slot name="footer" />
    </footer>
  </div>
</template>

<style scoped>
/* The bars stay put, only the rows below them move. The sheet is pinned to row
   two so a screen with no entry bar does not pull its rows up into that row. */
.screen {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: minmax(0, 1fr);
  flex: 1 1 0;
  min-height: 0;

  > main {
    grid-row: 2;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}

/* The input bar above the scrolling rows: full-width rule, contents on the
   sheet. How the contents themselves lay out is the screen's business. */
.entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-rule);
  background-color: var(--color-paper);
}

/* The foot bar: the one figure a screen keeps under its rows. It is a row of
   the screen's grid rather than an overlay on the sheet, so the last row can
   never end up hidden behind it. Set in ink, the way a submit is, so the
   running total reads as the sum of the whole pad rather than one more row. */
footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-ink);
  color: var(--color-paper);
}
</style>
