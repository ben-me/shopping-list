/**
 * The Shopping List service worker: it caches the app shell — the document
 * and static assets — so a cold start with no network opens the app on the
 * last-synced data instead of an error page. It never touches `/api`: the
 * local Store (dexie) is the read source, so stale data can never be served
 * as if it were fresh.
 *
 * Static assets are cache-first (immutable hashed files in a build); the
 * dev server's mutable assets are re-warmed by src/pwa.ts on every online
 * load. Navigations are network-first with the cached shell as fallback.
 *
 * Stored responses lose their `Vary` header and are keyed by request
 * destination: the dev server sends `Vary: Origin` (module scripts fetch
 * with an Origin header the URL-keyed entry lacks — a literal Vary match
 * would miss every script), and serves some URLs in two representations
 * (a CSS file as a JS module for imports, a stylesheet for `<link>`),
 * negotiated by the request.
 */
const SHELL_CACHE = "shopping-list-shell-v1";
// Keep in sync with the API guard in src/pwa.ts.
const API_PREFIX = "/api/";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith(API_PREFIX)) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

function cacheKey(url, destination) {
  const separator = url.includes("?") ? "&" : "?";
  return destination ? `${url}${separator}sw-dest=${destination}` : url;
}

async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putInShellCache(request.url, response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(request, { ignoreSearch: true })) ??
      (await caches.match(SHELL_URL, { ignoreSearch: true })) ??
      new Response("Offline", { status: 503, statusText: "Offline" })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(cacheKey(request.url, request.destination));
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putInShellCache(cacheKey(request.url, request.destination), response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/** Store without `Vary`, under the request-destination-keyed cache key. */
async function putInShellCache(key, response) {
  const headers = new Headers(response.headers);
  headers.delete("Vary");
  const body = await response.arrayBuffer();
  await (
    await caches.open(SHELL_CACHE)
  ).put(
    key,
    new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
}
