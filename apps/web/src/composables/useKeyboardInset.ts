import { onMounted, onUnmounted } from "vue";

const KEYBOARD_INSET = "--keyboard-inset";

function track(viewport: VisualViewport) {
  const root = document.documentElement;
  let applied: number | null = null;

  // The keyboard covers the bottom of the layout viewport; offsetTop is how
  // much of that viewport the page has already scrolled past.
  function update() {
    const covered = window.innerHeight - viewport.height - viewport.offsetTop;
    const inset = Math.max(0, Math.round(covered));
    if (inset === applied) {
      return;
    }
    applied = inset;
    root.style.setProperty(KEYBOARD_INSET, `${inset}px`);
  }

  onMounted(() => {
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update, { passive: true });
    update();
  });

  onUnmounted(() => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    root.style.removeProperty(KEYBOARD_INSET);
  });
}

/** Height the on-screen keyboard covers, as `--keyboard-inset` on the root element. */
export function useKeyboardInset() {
  const viewport = window.visualViewport;
  if (viewport) {
    track(viewport);
  }
}
