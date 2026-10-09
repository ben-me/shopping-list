import { shallowRef } from "vue";

/**
 * Test double for the better-auth client (`src/auth-client.ts`).
 *
 * The real client captures `fetch` at creation time, which defeats
 * `vi.stubGlobal` after import. This mock mirrors the client's public
 * contract — `useSession()` exposing atom snapshots through a Vue ref, a
 * one-shot `hydrateSession`, and actions that refetch the session ~10ms
 * after success — while delegating the actual HTTP requests to (stubbed)
 * global fetch at call time, so the route-map stubbing used across specs
 * keeps working.
 */
interface Snapshot {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isRefetching: boolean;
  refetch: () => Promise<void>;
}

/** A flight that landed after a newer flight must not apply. */
type Flight = symbol;

let snapshot: Snapshot = {
  data: null,
  error: null,
  isPending: true,
  isRefetching: false,
  refetch: () => fetchSession(),
};

const listeners = new Set<(snapshot: Snapshot) => void>();

let activeFlight: Flight | null = null;
let hydrated = false;

function emit() {
  for (const listener of listeners) {
    listener(snapshot);
  }
}

async function fetchSession() {
  const flight: Flight = Symbol();
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
    if (activeFlight !== flight) {
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
    if (activeFlight !== flight) {
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

function subscribeAtom(listener: (snapshot: Snapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  // Unlike the real atom's onMount (one fetch per mount), every fresh hook
  // instance here re-fetches: a spec's next boot must run under that spec's
  // own stubs, not a leftover snapshot from the previous one.
  void fetchSession();
  return () => {
    listeners.delete(listener);
  };
}

// fallow-ignore-next-line unused-export -- loaded dynamically by the specs (vi.mock factory import), which static analysis cannot see
export function makeAuthClientMock() {
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { credentials: "include", ...init });
    const body = await response.json().catch(() => null);
    const result = response.ok
      ? { data: body, error: null }
      : { data: null, error: body as { message?: string; status?: number } };
    // Like the real client, a successful auth action refetches the session ~10ms later.
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
      useSession() {
        // Mirrors `useStore`: a shallow ref fed by an atom subscription.
        const state = shallowRef<Snapshot | undefined>(undefined);
        subscribeAtom((next) => {
          state.value = next;
        });
        return state;
      },
    },
  };
}
