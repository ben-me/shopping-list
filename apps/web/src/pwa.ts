export const SERVICE_WORKER_URL = "/sw.js";
export const SHELL_CACHE = "shopping-list-shell-v1";
// Keep in sync with the API guard in public/sw.js.
const API_PREFIX = "/api/";

let shellWarmed = false;

/**
 * True once the service worker is active and the shell cache holds the app
 * shell, so a cold start with no network can serve it from cache.
 */
export function isShellWarmed(): boolean {
  return shellWarmed;
}

/**
 * Register the service worker and warm the shell cache so the very first
 * visit already yields an offline-capable app.
 *
 * The shell cache normally fills as a background side effect of the service
 * worker's fetch handler — but a first visit loads the page before the
 * worker is controlling it, so those fetches bypass the cache entirely.
 * Warming re-fetches everything the page actually loaded (same-origin
 * assets only, never `/api`) into the shell cache once the worker is ready.
 *
 * The PWA is an enhancement: every failure here is swallowed and the app
 * keeps working as a plain online page.
 */
export async function warmServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    await navigator.serviceWorker.ready;
    await warmShellCache();
    shellWarmed = true;
  } catch {
    // Installing the PWA never blocks the app.
  }
}

async function warmShellCache(): Promise<void> {
  if (!("caches" in window)) {
    return;
  }
  const cache = await caches.open(SHELL_CACHE);
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const warmable = entries
    .filter((entry) => sameOriginShellAsset(entry.name))
    .map((entry) => ({ url: entry.name, destination: destinationOf(entry) }));
  await Promise.all([
    warmCacheEntry(cache, { url: "/", destination: "" }),
    ...warmable.map((entry) => warmCacheEntry(cache, entry)),
  ]);
}

async function warmCacheEntry(
  cache: Cache,
  warmable: { url: string; destination: string },
): Promise<void> {
  try {
    const key = cacheKey(warmable.url, warmable.destination);
    if (await cache.match(key)) {
      return;
    }
    // The dev server content-negotiates some assets by `Accept` (a CSS file
    // is a stylesheet for `text/css` and a JS module otherwise), so the
    // warm-up must ask for the same representation the real request uses.
    const headers: HeadersInit =
      warmable.destination === "style" ? { Accept: "text/css,*/*;q=0.1" } : {};
    const response = await fetch(warmable.url, { headers });
    if (response.ok) {
      await putInCache(cache, key, response);
    }
  } catch {
    // A single asset failing to warm never blocks the others.
  }
}

function sameOriginShellAsset(url: string): boolean {
  const parsed = new URL(url, window.location.origin);
  return parsed.origin === window.location.origin && !parsed.pathname.startsWith(API_PREFIX);
}

/**
 * The request destination a resource entry was loaded with — part of the
 * shell cache key (mirrors cacheKey in public/sw.js). Resource timing only
 * exposes the initiator, so the common initiators are mapped and anything
 * else warms under the plain URL; a mismatching warm entry is simply
 * fetched and stored again under its real key by the service worker.
 */
export function destinationOf(entry: PerformanceResourceTiming): string {
  switch (entry.initiatorType) {
    case "script":
      return "script";
    case "link":
      return "style";
    default:
      return "";
  }
}

export function cacheKey(url: string, destination: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return destination ? `${url}${separator}sw-dest=${destination}` : url;
}

/**
 * Store a response without its `Vary` header — the dev server sends
 * `Vary: Origin`, and a literal Vary match would miss every request that
 * carries an `Origin` header (module scripts do). Mirrors putInShellCache
 * in public/sw.js.
 */
async function putInCache(cache: Cache, key: string, response: Response): Promise<void> {
  const headers = new Headers(response.headers);
  headers.delete("Vary");
  const body = await response.arrayBuffer();
  await cache.put(
    key,
    new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
}
