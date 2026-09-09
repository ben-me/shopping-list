import { reactive } from "vue";
import { authClient } from "./auth-client";

const SESSION_CACHE_KEY = "shopping-list:session-user";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
}

/**
 * Client-side session state. The server session lives in the better-auth
 * cookie; this reactive mirror is the single read surface for the UI and the
 * route guard. It is populated from `get-session` on boot and updated by the
 * sign-in/sign-up/sign-out actions below. The last known user is also cached
 * in localStorage so an offline boot (the server cannot be reached to confirm
 * the cookie) still restores the session and the app opens on last-synced
 * data instead of bouncing to sign-in.
 */
export const session = reactive<{ user: SessionUser | null }>({
  user: null,
});

let activeRestore: Promise<void> | null = null;

/**
 * Fetch the current session from the API. If a restore is already in
 * flight, concurrent callers share it rather than starting a new one. A
 * reachable server always wins: if it says there is no session, the user
 * is signed out (no stale cached user).
 */
export function restoreSession() {
  if (activeRestore) {
    return activeRestore;
  }
  activeRestore = fetchSession().finally(() => {
    // Clear the slot so the next call performs a fresh fetch.
    activeRestore = null;
  });
  return activeRestore;
}

async function fetchSession() {
  try {
    const { data } = await authClient.getSession();
    session.user = data?.user ?? null;
    cacheUser(session.user);
  } catch {
    // Server unreachable (offline): fall back to the cached user so the app
    // still opens on last-synced data rather than forcing a sign-in.
    session.user = cachedUser();
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-in failed");
  }
  session.user = data?.user as SessionUser;
  cacheUser(session.user);
}

export async function signUp(name: string, email: string, password: string) {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-up failed");
  }
  session.user = data?.user;
  cacheUser(session.user);
}

export async function signOut() {
  try {
    await authClient.signOut();
  } finally {
    // The session is dead client-side even if the request failed.
    session.user = null;
    cacheUser(null);
  }
}

export function _resetSession() {
  session.user = null;
  cacheUser(null);
}

function cacheUser(user: SessionUser | null): void {
  try {
    if (user) {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_CACHE_KEY);
    }
  } catch {
    // Storage unavailable (private mode, quota): the cache is an
    // optimisation, never a requirement.
  }
}

function cachedUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}
