/**
 * Test double for the better-auth client (`src/auth-client.ts`).
 *
 * The real client captures `fetch` at creation time, which defeats
 * `vi.stubGlobal` after import. This mock mirrors the client's contract —
 * methods resolve `{ data, error }` — while delegating the actual HTTP
 * request to (stubbed) global fetch at call time, so the route-map stubbing
 * used across component specs keeps working.
 */
async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "include", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: body as { message?: string; status?: number } };
  }
  return { data: body, error: null };
}

function post(path: string) {
  return (body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
}

export function makeAuthClientMock() {
  return {
    authClient: {
      getSession: () => request("/api/auth/get-session"),
      signIn: { email: post("/api/auth/sign-in/email") },
      signUp: { email: post("/api/auth/sign-up/email") },
      signOut: post("/api/auth/sign-out"),
    },
  };
}
