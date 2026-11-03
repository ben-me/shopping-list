import { onMounted, onUnmounted } from "vue";

const KEYBOARD_VISIBLE_HEIGHT = "--keyboard-visible-height";

function isTextField(element: Element | null): boolean {
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable || element.matches("input, textarea"))
  );
}

function track(viewport: VisualViewport) {
  const root = document.documentElement;
  let applied: number | null = null;

  function update() {
    const keyboardOpen = isTextField(document.activeElement) && viewport.scale <= 1;
    const covered = keyboardOpen ? window.innerHeight - viewport.height - viewport.offsetTop : 0;
    const inset = Math.max(0, Math.round(covered));
    if (inset === applied) {
      return;
    }
    applied = inset;

    if (inset === 0) {
      root.style.removeProperty(KEYBOARD_VISIBLE_HEIGHT);
      delete root.dataset.keyboardOpen;
      return;
    }

    root.style.setProperty(
      KEYBOARD_VISIBLE_HEIGHT,
      `${Math.round(viewport.height + viewport.offsetTop)}px`,
    );
    root.dataset.keyboardOpen = "true";
  }

  onMounted(() => {
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update, { passive: true });
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
  });

  onUnmounted(() => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    document.removeEventListener("focusin", update);
    document.removeEventListener("focusout", update);
    root.style.removeProperty(KEYBOARD_VISIBLE_HEIGHT);
    delete root.dataset.keyboardOpen;
  });
}

export function useKeyboardInset() {
  const viewport = window.visualViewport;
  if (viewport) {
    track(viewport);
  }
}
