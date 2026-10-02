<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

/** The List's sections: Items, Payments, and the household behind them. */
const props = defineProps<{ listId: string }>();

const route = useRoute();

/**
 * The section underline: one line that rides under whichever section is open.
 * The tab bar lives in the persistent List layout, so when the route changes
 * this element is never re-created — it is measured anew against the active
 * tab and glides over with a CSS transition instead of blinking into place.
 * The nav draws the line itself, from the two custom properties the measurement
 * leaves behind.
 */
const nav = ref<HTMLElement | null>(null);
const lineStyle = ref({ "--line-left": "0px", "--line-width": "0px" });
/**
 * False until the line has been placed under the open section for the first
 * time. That first placement paints without a transition — the line appears
 * under the open section, it does not draw itself in from the corner. Once
 * that frame has committed the flag flips, and every later change glides.
 */
const placed = ref(false);

function scheduleMeasure() {
  void nextTick(() => {
    const bar = nav.value;
    const active = bar?.querySelector<HTMLElement>('.tab[aria-current="page"]');
    if (!bar || !active) {
      return;
    }
    const barRect = bar.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    lineStyle.value = {
      "--line-left": `${tabRect.left - barRect.left}px`,
      "--line-width": `${tabRect.width}px`,
    };
    if (!placed.value) {
      // Flip a frame later, once this first position has committed, so the
      // transition is only ever armed for the placements after it.
      requestAnimationFrame(() => {
        placed.value = true;
      });
    }
  });
}

onMounted(scheduleMeasure);
watch(() => route.name, scheduleMeasure);
watch(() => props.listId, scheduleMeasure);
</script>

<template>
  <nav ref="nav" aria-label="Sections" :class="{ 'no-animate': !placed }" :style="lineStyle">
    <RouterLink class="tab" :to="{ name: 'list', params: { listId } }">Items</RouterLink>
    <RouterLink class="tab" :to="{ name: 'list-payments', params: { listId } }"
      >Payments</RouterLink
    >
    <RouterLink class="tab" :to="{ name: 'list-members', params: { listId } }">Members</RouterLink>
  </nav>
</template>

<style scoped>
/* The row rides on the same sheet and inset as the account line above it, and
   the `tab` class stays on the links as the handle the underline measures. */
nav {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  max-width: var(--sheet-width);
  margin-inline: auto;
  padding-inline: var(--space-4);

  /* The tab bar bleeds its first tab past the sheet's inset, so the bar's own
     left edge lines up with the account line above it. */
  & > :first-child {
    margin-inline-start: calc(var(--space-3) * -1);
  }

  a {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-size);
    padding-inline: var(--space-3);
    color: var(--color-ink-muted);
    font-size: var(--fs-small);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      color: var(--color-ink);
    }

    /* The open section reads in ink against the muted tabs beside it — identity,
       never the only marker. */
    &[aria-current="page"] {
      color: var(--color-ink);
    }
  }

  /* The underline, drawn between the two measurements the script leaves behind. */
  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: var(--line-left);
    width: var(--line-width);
    height: 3px;
    background-color: var(--list-accent, var(--color-ink));
    pointer-events: none;
    transition:
      left 240ms ease,
      width 240ms ease;
  }

  /* The first placement lands without the glide (see the `placed` flag). */
  &.no-animate::after {
    transition: none;
  }
}
</style>
