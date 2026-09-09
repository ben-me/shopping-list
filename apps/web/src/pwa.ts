/**
 * The load this page started with was already controlled by the service
 * worker, so everything it fetched went through the worker's routes and is
 * cached. Captured at module evaluation, before a mid-load activation could
 * take over control.
 */
const controlledAtBoot =
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  !!navigator.serviceWorker.controller;

let shellWarmed = false;

/** True once the worker is active and the shell can be served from cache. */
export function isShellWarmed(): boolean {
  return shellWarmed;
}

/**
 * Wait for the service worker and report shell readiness. In a production
 * build the precache manifest installs the whole shell during install, so
 * the first visit is offline-capable. In dev there is no build output to
 * precache: only a load controlled from the start gets its assets cached by
 * the worker's NetworkFirst route, so a first visit needs one reload (the
 * e2e warm-up does it, see e2e/pwa-offline.spec.ts). The PWA is an
 * enhancement: failures never block the app.
 */
export async function warmServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.ready;
    shellWarmed = import.meta.env.PROD || controlledAtBoot;
  } catch {
    // Installing the PWA never blocks the app.
  }
}
