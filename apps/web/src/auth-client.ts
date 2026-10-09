import { createAuthClient } from "better-auth/vue";

/**
 * better-auth client for the web app.
 *
 * No `baseURL` is set: the client defaults to the current origin and hits
 * `/api/auth/*`. In dev the Vite server proxies `/api` to the hono API on
 * localhost:8787, so requests (and the session cookie) stay same-origin.
 *
 * Session revalidation is the native atom machinery: the session is re-fetched
 * on window focus (rate-limited to once per 5s) and when connectivity
 * returns, but never while offline, and no polling — the app revalidates on
 * user-visible events, not on a timer.
 */
export const authClient = createAuthClient({
  sessionOptions: {
    refetchOnWindowFocus: true,
    refetchWhenOffline: false,
  },
});
