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
 * cookie; this reactive mirror is the single read surface for the UI and the
 * route guard. It is populated from `get-session` on boot and updated by the
 * sign-in/sign-up/sign-out actions below.
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
  } catch {
    // Server unreachable: start signed out rather than guessing.
    session.user = null;
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-in failed");
  }
  session.user = data?.user as SessionUser;
}

export async function signUp(name: string, email: string, password: string) {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) {
    throw new Error(error.message ?? "Sign-up failed");
  }
  session.user = data?.user;
}

export async function signOut() {
  try {
    await authClient.signOut();
  } finally {
    // The session is dead client-side even if the request failed.
    session.user = null;
  }
}

export function _resetSession() {
  session.user = null;
}
