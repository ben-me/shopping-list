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
   sheet. The screens fill the slots, so these reach them through
   `::v-slotted`; how the contents lay out is the screen's business. */
.entry {
  display: flex;
  justify-content: center;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-rule);

  > ::v-slotted(*) {
    width: 100%;
    max-width: calc(var(--sheet-width) - var(--space-3) * 2);
  }

  /* Everything but the first child, the way `* + *` would say it. */
  > ::v-slotted(:nth-child(n + 2)) {
    margin-block-start: var(--space-1);
  }

  ::v-slotted(form) {
    display: flex;
    gap: var(--space-2);
  }

  ::v-slotted(input) {
    padding-inline: var(--space-1);
    font-size: var(--fs-small);
  }

  ::v-slotted(.error) {
    font-size: var(--fs-small);
  }
}

/* The foot bar: the one figure a screen keeps under its rows. It is a row of
   the screen's grid rather than an overlay on the sheet, so the last row can
   never end up hidden behind it, and it is set in ink the way a submit is so
   the running total reads as the sum of the whole pad. */
footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-ink);
  color: var(--color-paper);
}

.screen-footer > ::v-slotted(*) {
  width: 100%;
  max-width: calc(var(--sheet-width) - var(--space-3) * 2);
}
</style>
