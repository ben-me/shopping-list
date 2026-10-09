import { reactive } from "vue";
import type { Router } from "vue-router";
import { apiFetch } from "./api";
import { authClient } from "./auth-client";
import { db } from "./db";
import { ensureStoreForUser } from "./store-owner";

const SESSION_CACHE_KEY = "shopping-list:session-user";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: string;
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

/** Set while a sign-out navigation is in flight; lets the route guard admit the guest-only sign-in route. */
export let signingOut = false;

let activeRestore: Promise<void> | null = null;

/**
 * Bumped by every action that sets the session authoritatively (sign-in,
 * sign-up, sign-out). A session fetch captures the epoch when it starts and
 * throws its result away if the epoch has moved on, so a slow fetch that
 * lands after a sign-in or sign-out cannot clobber the fresher state.
 */
let sessionEpoch = 0;

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
  activeRestore = fetchSession(sessionEpoch).finally(() => {
    // Clear the slot so the next call performs a fresh fetch.
    activeRestore = null;
  });
  return activeRestore;
}

/**
 * Revalidate the session in the background — stale-while-revalidate for
 * callers (the route guard) that already have a session to resolve from and
 * must never wait on the network. Concurrent calls share the in-flight
 * fetch; nobody awaits the result.
 */
export function revalidateSession(): void {
  void restoreSession();
}

async function fetchSession(epoch: number) {
  try {
    const { data } = await authClient.getSession();
    if (epoch !== sessionEpoch) return;
    session.user = data?.user ?? null;
  } catch {
    // Server unreachable (offline): fall back to the cached user so the app
    // still opens on last-synced data rather than forcing a sign-in.
    if (epoch !== sessionEpoch) return;
    session.user = cachedUser();
  }
  if (epoch !== sessionEpoch) return;
  await adoptUser(session.user);
}

/** Scope the Store to the session user; best-effort so the session always opens. */
async function adoptUser(user: SessionUser | null) {
  cacheUser(user);
  if (!user) {
    return;
  }
  try {
    await ensureStoreForUser(db, user.id);
  } catch {
    // Best-effort: never block the session.
  }
}

export async function signIn(email: string, password: string) {
  sessionEpoch += 1;
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-in failed");
  }
  session.user = data?.user as SessionUser;
  await adoptUser(session.user);
}

export async function signUp(name: string, email: string, password: string) {
  sessionEpoch += 1;
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-up failed");
  }
  session.user = data?.user;
  await adoptUser(session.user);
}

/**
 * Whether the one-time bootstrap sign-up is still open (ADR 0003): true only
 * while the user table is empty, then closed for good. The sign-in view shows
 * the "Create an account" toggle only while this is true; when the status
 * cannot be reached it assumes sign-up is closed — provisioning is the only
 * door in, and that never happens through the sign-in view.
 */
export async function isSignUpOpen(): Promise<boolean> {
  try {
    const body = await apiFetch<{ signUpOpen?: boolean }>("/api/signup-status");
    return body?.signUpOpen === true;
  } catch {
    return false;
  }
}

export async function signOut() {
  sessionEpoch += 1;
  try {
    await authClient.signOut();
  } finally {
    // The session is dead client-side even if the request failed.
    session.user = null;
    cacheUser(null);
    await clearLocalStore();
  }
}

/** Navigate to sign-in before tearing down, so the current view never re-renders signed out. */
export async function signOutAndRedirect(router: Router) {
  signingOut = true;
  try {
    await router.push({ name: "sign-in" });
  } finally {
    signingOut = false;
  }
  await signOut();
}

async function clearLocalStore() {
  try {
    await db.clearAll();
  } catch {
    // Best-effort: the session must clear even if the Store fails.
  }
}

export function _resetSession() {
  sessionEpoch += 1;
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
