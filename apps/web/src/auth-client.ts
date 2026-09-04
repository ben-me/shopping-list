import { createAuthClient } from "better-auth/vue";

/**
 * better-auth client for the web app.
 *
 * No `baseURL` is set: the client defaults to the current origin and hits
 * `/api/auth/*`. In dev the Vite server proxies `/api` to the hono API on
 * localhost:8787, so requests (and the session cookie) stay same-origin.
 */
export const authClient = createAuthClient();
