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

/** The session atom behind `useSession()`, read directly so side effects run sync with it. */
interface SessionSnapshot {
  data: { session: unknown; user: unknown } | null;
  error: { status?: number; message?: string } | null;
  isPending: boolean;
  isRefetching: boolean;
}

interface SessionStore {
  get(): SessionSnapshot;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
}

const sessionStore = (
  authClient.$store as unknown as {
    atoms: { session: SessionStore };
  }
).atoms.session;

export const session = reactive<{ user: SessionUser | null }>({
  user: null,
});

/** Set while a sign-out navigation is in flight; lets the route guard admit the guest-only sign-in route. */
export let signingOut = false;

function canHydrateFromCache(snapshot: SessionSnapshot): boolean {
  // Unreachable server: data stays null and the error lands. A reachable one answers "no session" without an error.
  return snapshot.error !== null && snapshot.data === null;
}

function sessionUserOf(snapshot: SessionSnapshot): SessionUser | null {
  return (snapshot.data?.user as SessionUser | undefined) ?? null;
}

let bootPromise: Promise<void> | null = null;

/** Wait for the atom's first fetch once; on a failed fetch, seed it with the cached user. */
export function bootSession(): Promise<void> {
  bootPromise ??= (async () => {
    startSessionObserver();
    // A settled observation records itself immediately; read the cache before it can clear it.
    const cacheCandidate = cachedUser();
    await untilSettled();
    const snapshot = sessionStore.get();
    if (canHydrateFromCache(snapshot) && cacheCandidate) {
      hydrateFromCache(cacheCandidate);
    }
    await adoptChain;
  })();
  return bootPromise;
}

function untilSettled(): Promise<void> {
  return new Promise<void>((resolve) => {
    let unbind: (() => void) | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      unbind?.();
    };
    unbind = sessionStore.subscribe((snapshot) => {
      if (!snapshot.isPending && !stopped) {
        stop();
        resolve();
      }
    });
    if (stopped) {
      unbind();
    }
  });
}

let sessionObserver: (() => void) | null = null;

function startSessionObserver(): void {
  sessionObserver ??= sessionStore.subscribe(onSessionAtom);
}

function onSessionAtom(snapshot: SessionSnapshot): void {
  if (snapshot.isPending) {
    return;
  }
  void recordUser(sessionUserOf(snapshot));
}

/** Undefined until the first settled observation, so a signed-out boot never clears the Store. */
let lastUserSerial: string | null | undefined = undefined;

let adoptChain: Promise<void> = Promise.resolve();

function recordUser(user: SessionUser | null): Promise<void> {
  session.user = user;
  const serial = user ? JSON.stringify(user) : null;
  if (serial === lastUserSerial) {
    return Promise.resolve();
  }
  lastUserSerial = serial;
  // The Store wipe stays in signOut: a remote "no session" must not destroy local data.
  const job = user ? adoptUser(user) : Promise.resolve(cacheUser(null));
  adoptChain = adoptChain.then(() => job).catch(() => undefined);
  return job;
}

async function adoptUser(user: SessionUser): Promise<void> {
  cacheUser(user);
  try {
    await ensureStoreForUser(db, user.id);
  } catch {
    // Best-effort: never block the session.
  }
}

function hydrateFromCache(user: SessionUser): void {
  const epoch = new Date(0).toISOString();
  try {
    // The fake session fields only satisfy the atom's shape; the next real refetch replaces them.
    authClient.hydrateSession({
      user,
      session: {
        id: "cached",
        token: "",
        userId: user.id,
        expiresAt: epoch,
        createdAt: epoch,
        updatedAt: epoch,
        ipAddress: null,
        userAgent: null,
      },
    } as never);
  } catch {
    // Hydrating is an optimisation; the boot must succeed without it.
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-in failed");
  }
  await recordUser(data?.user as SessionUser | null);
}

export async function signUp(name: string, email: string, password: string) {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-up failed");
  }
  await recordUser(data?.user as SessionUser | null);
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
  try {
    await authClient.signOut();
  } finally {
    // The session is dead client-side even if the request failed.
    await recordUser(null);
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

/** Test isolation hook: forget the user and the boot, and unmount the atom so the next boot re-fetches. */
export function _resetSession(): void {
  bootPromise = null;
  sessionObserver?.();
  sessionObserver = null;
  lastUserSerial = undefined;
  session.user = null;
  (sessionStore as { _reset?: () => void })._reset?.();
}

function cacheUser(user: SessionUser | null): void {
  try {
    if (user) {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_CACHE_KEY);
    }
  } catch {
    // Storage unavailable: the cache is an optimisation, never a requirement.
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
