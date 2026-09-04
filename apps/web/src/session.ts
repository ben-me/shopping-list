import { reactive } from "vue";
import { authClient } from "./auth-client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
}

/**
 * Client-side session state. The server session lives in the better-auth
 * cookie; this reactive mirror is populated from `get-session` on boot and
 * by the sign-in/sign-up/sign-out actions below.
 */
export const session = reactive<{ user: SessionUser | null; restoring: boolean }>({
  user: null,
  restoring: true,
});

let restorePromise: Promise<void> | null = null;

/**
 * Fetch the current session from the API exactly once; concurrent callers
 * share the in-flight request. A reachable server always wins: if it says
 * there is no session, the user is signed out (no stale cached user).
 */
export function restoreSession(): Promise<void> {
  restorePromise ??= (async () => {
    try {
      const { data } = await authClient.getSession();
      session.user = (data?.user as SessionUser | null | undefined) ?? null;
    } catch {
      // Server unreachable: start signed out rather than guessing.
      session.user = null;
    } finally {
      session.restoring = false;
    }
  })().finally(() => {
    restorePromise = null;
  });
  return restorePromise;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-in failed");
  }
  session.user = data?.user as SessionUser;
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-up failed");
  }
  session.user = data?.user as SessionUser;
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    // The session is dead client-side even if the request failed.
    session.user = null;
  }
}
