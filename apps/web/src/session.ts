import { reactive } from "vue";
import { apiFetch } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
}

export interface SessionState {
  user: SessionUser | null;
  restoring: boolean;
}

const STORAGE_KEY = "shopping-list.session-user";

const state = reactive<SessionState>({ user: null, restoring: true });

export const session = state;

export async function restoreSession(): Promise<void> {
  if (!state.restoring) {
    return;
  }
  try {
    const body = await apiFetch<{ user?: SessionUser | null } | null>("/api/auth/get-session");
    const user = body?.user ?? null;
    if (user) {
      persistUser(user);
    } else {
      clearStoredUser();
    }
    state.user = user;
  } catch {
    state.user = readStoredUser();
  } finally {
    state.restoring = false;
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { user } = await apiFetch<{ token: string; user: SessionUser }>("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  persistUser(user);
  state.user = user;
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  const { user } = await apiFetch<{ token: string; user: SessionUser }>("/api/auth/sign-up/email", {
    method: "POST",
    body: { name, email, password },
  });
  persistUser(user);
  state.user = user;
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/auth/sign-out", { method: "POST", body: {} }).catch(() => undefined);
  clearStoredUser();
  state.user = null;
}

function persistUser(user: SessionUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

function clearStoredUser() {
  localStorage.removeItem(STORAGE_KEY);
}

function readStoredUser(): SessionUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}
