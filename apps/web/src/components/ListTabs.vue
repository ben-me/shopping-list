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
/**
 * False until the line has been placed under the open section for the first
 * time. That first placement paints without a transition — the line appears
 * under the open section, it does not draw itself in from the corner. Once
 * that frame has committed the flag flips, and every later change glides.
 */
const placed = ref(false);

function scheduleMeasure() {
  void nextTick(() => {
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
  <RouterLink class="tab" :to="{ name: 'list', params: { listId } }">Items</RouterLink>
  <RouterLink class="tab" :to="{ name: 'list-payments', params: { listId } }">Payments</RouterLink>
  <RouterLink class="tab" :to="{ name: 'list-members', params: { listId } }">Members</RouterLink>
  <span ref="line" :class="{ 'no-animate': !placed }" aria-hidden="true" :style="lineStyle"></span>
</template>

<style scoped>
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

  /* The first placement lands without the glide (see the `placed` flag). */
  &.no-animate {
    transition: none;
  }
}
</style>
