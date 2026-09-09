/**
 * Whether this page load was handled by the service worker from its very
 * first request — only such a load had every asset routed and cached.
 * Captured at module evaluation, before a mid-load activation could take
 * over control.
 */
const startedUnderServiceWorker =
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  !!navigator.serviceWorker.controller;

let ready = false;

/** True once the worker is active and the app shell can be served offline. */
export function serviceWorkerReady(): boolean {
  return ready;
}

/**
 * Wait for the service worker and report readiness. In a production build
 * the precache manifest installs the whole shell during install, so the
 * first visit is already offline-capable. In dev there is no build output
 * to precache: only a load handled by the worker from the start gets its
 * assets cached by the worker's NetworkFirst route, so a first visit needs
 * one reload (the e2e warm-up does it, see e2e/pwa-offline.spec.ts). The
 * PWA is an enhancement: failures never block the app.
 */
export async function prepareServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.ready;
    ready = import.meta.env.PROD || startedUnderServiceWorker;
  } catch {
    // Installing the PWA never blocks the app.
  }
}
