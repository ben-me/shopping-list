/**
 * Test double for the better-auth client (`src/auth-client.ts`).
 *
 * The real client captures `fetch` at creation time, which defeats
 * `vi.stubGlobal` after import. This mock mirrors the client's session-atom
 * contract — `{ data, error, isPending, isRefetching, refetch }` snapshots
 * delivered to subscribers, a one-shot `hydrateSession`, and actions that
 * trigger a session refetch on their atom signal — while delegating the
 * actual HTTP requests to (stubbed) global fetch at call time, so the
 * route-map stubbing used across specs keeps working.
 */
interface Snapshot {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isRefetching: boolean;
  refetch: () => Promise<void>;
}

type Listener = (snapshot: Snapshot) => void;

/** A flight that landed after a newer flight or a `_reset` must not apply. */
interface Flight {
  token: symbol;
  generation: number;
}

// fallow-ignore-next-line unused-export -- loaded dynamically by the specs (vi.mock factory import), which static analysis cannot see
export function makeAuthClientMock() {
  const initial = (): Snapshot => ({
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch: () => fetchSession(),
  });

  let snapshot = initial();
  const listeners = new Set<Listener>();
  /** Set once a subscriber mounts the atom, as the real atom's onMount would. */
  let mounted = false;
  /** Bumped by `_reset`: flights of the previous life must never apply. */
  let generation = 0;
  let activeFlight: Flight | null = null;
  let hydrated = false;

  function emit() {
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function stale(flight: Flight): boolean {
    return activeFlight !== flight || flight.generation !== generation;
  }

  async function fetchSession() {
    const flight: Flight = { token: Symbol("flight"), generation };
    // Starting a flight cancels any in-flight one, like the atom's
    // AbortController: a sign-in/sign-out while the boot fetch is in flight
    // supersedes and discards it.
    activeFlight = flight;
    snapshot = {
      ...snapshot,
      error: null,
      isPending: snapshot.data === null,
      isRefetching: true,
    };
    emit();
    try {
      const response = await fetch("/api/auth/get-session", { credentials: "include" });
      const body = (await response.json().catch(() => null)) as unknown;
      if (stale(flight)) {
        return;
      }
      snapshot = {
        ...snapshot,
        data: response.ok ? (body ?? null) : null,
        error: response.ok ? null : (body as { message?: string; status?: number }),
        isPending: false,
        isRefetching: false,
      };
      emit();
    } catch (error) {
      if (stale(flight)) {
        return;
      }
      // Network failure: the atom keeps the last data and reports the error.
      snapshot = {
        ...snapshot,
        data: snapshot.data,
        error,
        isPending: false,
        isRefetching: false,
      };
      emit();
    }
  }

  function reset() {
    // Put the atom back into its pre-mount state: no subscribers, no
    // scheduled fetches. The next subscription mounts it fresh, so the boot
    // fetch always runs under the next spec's stubbed fetch — never a leaked
    // timer from a previous one.
    generation += 1;
    activeFlight = null;
    hydrated = false;
    mounted = false;
    listeners.clear();
    snapshot = initial();
  }

  const sessionAtom = {
    get: () => snapshot,
    subscribe(listener: Listener) {
      listeners.add(listener);
      listener(snapshot);
      if (!mounted) {
        mounted = true;
        // The real atom schedules its mount fetch on a 0ms timer; here the
        // fetch starts synchronously (still resolved through the stub). A
        // timer would put the whole boot one macrotask later, racing every
        // first-flush view read against its own data.
        void fetchSession();
      }
      return () => {
        listeners.delete(listener);
      };
    },
    _reset: reset,
  };

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { credentials: "include", ...init });
    const body = await response.json().catch(() => null);
    const result = response.ok
      ? { data: body, error: null }
      : { data: null, error: body as { message?: string; status?: number } };
    // Like the real client, a successful auth action flips the session
    // signal ~10ms later, which refetches the session atom.
    if (response.ok) {
      setTimeout(() => void fetchSession(), 10);
    }
    return result;
  }

  function post(path: string) {
    return (body: unknown) =>
      request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
  }

  return {
    authClient: {
      signIn: { email: post("/api/auth/sign-in/email") },
      signUp: { email: post("/api/auth/sign-up/email") },
      signOut: post("/api/auth/sign-out"),
      hydrateSession(sessionData: unknown) {
        if (hydrated || sessionData === null || snapshot.data !== null) {
          return;
        }
        hydrated = true;
        snapshot = {
          ...snapshot,
          data: sessionData,
          error: null,
          isPending: false,
          isRefetching: false,
        };
        emit();
      },
      $store: {
        atoms: {
          session: sessionAtom,
        },
      },
    },
  };
}
