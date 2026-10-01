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
 */
const line = ref<HTMLElement | null>(null);
const lineStyle = ref({ left: "0px", width: "0px" });
/** False until the line has been placed under the open section for the first time. */
const settled = ref(false);
let measureQueued = false;
let arming = false;

function scheduleMeasure() {
  if (measureQueued) {
    return;
  }
  measureQueued = true;
  void nextTick(() => {
    measureQueued = false;
    const nav = line.value?.parentElement;
    const active = nav?.querySelector<HTMLElement>('.tab[aria-current="page"]');
    if (!nav || !active) {
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    lineStyle.value = {
      left: `${tabRect.left - navRect.left}px`,
      width: `${tabRect.width}px`,
    };
    if (!arming) {
      arming = true;
      // The first position paints without a transition — the line appears
      // under the open section, it does not draw itself in from the corner.
      // Once that frame has committed, arm the transition so every later
      // change glides.
      requestAnimationFrame(() => {
        settled.value = true;
      });
    }
  });
}

onMounted(scheduleMeasure);
watch(() => route.name, scheduleMeasure);
watch(() => props.listId, scheduleMeasure);
</script>

<template>
  <RouterLink class="tab" :to="{ name: 'list', params: { listId } }">Items</RouterLink>
  <RouterLink class="tab" :to="{ name: 'list-payments', params: { listId } }">Payments</RouterLink>
  <RouterLink class="tab" :to="{ name: 'list-members', params: { listId } }">Members</RouterLink>
  <span ref="line" :class="{ 'no-animate': !settled }" aria-hidden="true" :style="lineStyle"></span>
</template>

<style scoped>
/* The screen switcher: text tabs, the current one underlined like a paper tab.
   The `tab` class stays on the links as the handle the underline measures
   against. */
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
     never the only marker. The underline itself is the span below, not a shadow
     on the tab: one line for the whole bar, gliding over in the pad's own pen. */
  &[aria-current="page"] {
    color: var(--color-ink);
  }
}

/* The one span in the bar: the section underline, riding under the open tab. */
span {
  position: absolute;
  bottom: 0;
  height: 3px;
  background-color: var(--list-accent, var(--color-ink));
  pointer-events: none;
  transition:
    left 240ms ease,
    width 240ms ease;

  /* The first placement lands without the glide (see the `settled` flag). */
  &.no-animate {
    transition: none;
  }
}
</style>
