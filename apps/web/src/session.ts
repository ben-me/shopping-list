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
 * Contract of the session atom behind `authClient.useSession()` — the same
 * store components see through the hook (`{ data, error, isPending,
 * isRefetching, refetch }`). `session.ts` reaches the atom directly instead
 * of through the composable so the side effects below (Store scoping, cache
 * sync) run synchronously with it, never a tick later than the state.
 */
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

/**
 * Client-side session state. The server session lives in the better-auth
 * cookie and is mirrored by better-auth's native session atom, which fetches
 * on boot, revalidates on window focus and when connectivity returns, dedupes
 * concurrent flights and cancels superseded ones. `session` is the projection
 * of that atom the UI and the route guard read; the last known user is also
 * cached in localStorage so an offline boot (the atom starts empty and the
 * server cannot be reached to confirm the cookie) still restores the session
 * and the app opens on last-synced data instead of bouncing to sign-in.
 */
export const session = reactive<{ user: SessionUser | null }>({
  user: null,
});

/** Set while a sign-out navigation is in flight; lets the route guard admit the guest-only sign-in route. */
export let signingOut = false;

/**
 * A reachable server always wins: an answer of "no session" reports `{ data:
 * null, error: null }`, while an unreachable one (offline, network failure)
 * lands in `error` with `data` still `null`. Only the latter may resurrect
 * the cached user — a signed-out answer must never be second-guessed.
 */
function canHydrateFromCache(snapshot: SessionSnapshot): boolean {
  return snapshot.error !== null && snapshot.data === null;
}

function sessionUserOf(snapshot: SessionSnapshot): SessionUser | null {
  return (snapshot.data?.user as SessionUser | undefined) ?? null;
}

let bootPromise: Promise<void> | null = null;

/**
 * Boot the session: wait for the atom's first fetch once, and if it fails
 * because the server is unreachable, seed the atom with the cached user so
 * the app still opens offline. Every later call shares the first boot.
 */
export function bootSession(): Promise<void> {
  bootPromise ??= (async () => {
    // Subscribing mounts the atom: better-auth schedules the first
    // get-session fetch and starts the focus/online/broadcast revalidation.
    startSessionObserver();
    // Read the cache before the boot settles: a settled observation records
    // itself immediately (a signed-out one clears the cache), and only a
    // failed fetch — which is what hydration reacts to — can come from
    // having read it beforehand.
    const cacheCandidate = cachedUser();
    await untilSettled();
    const snapshot = sessionStore.get();
    if (canHydrateFromCache(snapshot) && cacheCandidate) {
      hydrateFromCache(cacheCandidate);
      // Hydration notifies the atom synchronously; the work it schedules
      // (cache write + Store scoping) is what the await below waits for.
    }
    await adoptChain;
  })();
  return bootPromise;
}

/**
 * Resolve once the atom has a settled answer for its first boot fetch: a
 * session, a signed-out answer, or a failure to reach the server.
 */
function untilSettled(): Promise<void> {
  return new Promise<void>((resolve) => {
    // The subscription invokes the listener synchronously with the current
    // (possibly already settled) snapshot, so stopping has to tolerate a
    // listener that fires before the unsubscribe handle exists.
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

/**
 * Keep the mirror and its side effects in sync with the atom. Subscribing
 * mounts the atom lazily — at the first boot, not at module import, so
 * nothing hits the network before the app actually navigates.
 */
function startSessionObserver(): void {
  sessionObserver ??= sessionStore.subscribe(onSessionAtom);
}

function onSessionAtom(snapshot: SessionSnapshot): void {
  if (snapshot.isPending) {
    return;
  }
  void recordUser(sessionUserOf(snapshot));
}

/**
 * Serial of the last recorded user. `undefined` until the very first settled
 * observation, so a boot with no session cannot be mistaken for a sign-out
 * and clear the store.
 */
let lastUserSerial: string | null | undefined = undefined;

/** Adopting a user and wiping the cache are chained, so concurrent session events never interleave. */
let adoptChain: Promise<void> = Promise.resolve();

/**
 * Record a session observation onto the mirror and its side effects: caching
 * the user always, and (for a signed-in user) scoping the Store to them.
 * The Store wipe on sign-out is deliberately *not* here — a reachable server
 * reporting "no session" or a remotely revoked cookie must not destroy local
 * data, only an explicit sign-out does.
 */
function recordUser(user: SessionUser | null): Promise<void> {
  session.user = user;
  const serial = user ? JSON.stringify(user) : null;
  if (serial === lastUserSerial) {
    return Promise.resolve();
  }
  lastUserSerial = serial;
  const job = user ? adoptUser(user) : Promise.resolve(cacheUser(null));
  adoptChain = adoptChain.then(() => job).catch(() => undefined);
  return job;
}

/** Scope the Store to the session user; take care of the cache as well. */
async function adoptUser(user: SessionUser): Promise<void> {
  cacheUser(user);
  try {
    await ensureStoreForUser(db, user.id);
  } catch {
    // Best-effort: never block the session.
  }
}

/**
 * Seed the atom with the cached user after a failed boot fetch. The fake
 * session fields are only there to satisfy the atom's shape — nothing reads
 * them, and the next successful refetch replaces the whole thing.
 */
function hydrateFromCache(user: SessionUser): void {
  const epoch = new Date(0).toISOString();
  try {
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
    // Hydrating is an optimisation — the boot must succeed without it.
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-in failed");
  }
  // The client refetches the session on the sign-in atom signal; recording
  // the user here scopes the Store before the post-sign-in screen renders.
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

/**
 * Test isolation hook, as the epoch bump was before: forget the recorded
 * user and the boot. Unsubscribing also unmounts the atom, so the next boot
 * re-subscribes and fetches fresh — the same lifecycle the atom re-runs on
 * its own when its last subscriber goes away.
 */
export function _resetSession(): void {
  bootPromise = null;
  sessionObserver?.();
  sessionObserver = null;
  lastUserSerial = undefined;
  session.user = null;
  // The cached user deliberately survives: an offline boot must pick it up.
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
