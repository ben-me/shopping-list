import { session, restoreSession, signIn, signOut, signUp, type SessionUser } from "../session";

/**
 * Mock the better-auth client module: the real client captures `fetch` at
 * creation time, so stubbing global fetch after import has no effect. The
 * mock mirrors the client's contract — methods resolve `{ data, error }` and
 * delegate the actual request to (stubbed) global fetch.
 */
vi.mock("../auth-client", () => {
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { credentials: "include", ...init });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { data: null, error: body as { message?: string; status?: number } };
    }
    return { data: body, error: null };
  }
  const post = (path: string) => (body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    authClient: {
      getSession: () => request("/api/auth/get-session"),
      signIn: { email: post("/api/auth/sign-in/email") },
      signUp: { email: post("/api/auth/sign-up/email") },
      signOut: post("/api/auth/sign-out"),
    },
  };
});

const user: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "[EMAIL]",
  emailVerified: true,
  image: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const fetchImpl = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function callsTo(path: string) {
  return fetchImpl.mock.calls.filter(([url]) => String(url).includes(path));
}

let fetchImpl: ReturnType<typeof stubFetch>;

function resetSession() {
  Object.assign(session, { user: null, restoring: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
});

describe("session", () => {
  it("restores the signed-in user from the server on boot", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await restoreSession();

    expect(callsTo("/api/auth/get-session")).toHaveLength(1);
    expect(session.user).toEqual(user);
    expect(session.restoring).toBe(false);
  });

  it("treats a missing session as signed out", async () => {
    fetchImpl = stubFetch(jsonResponse(null));
    await restoreSession();

    expect(session.user).toBeNull();
    expect(session.restoring).toBe(false);
  });

  it("keeps the app signed out when the server is unreachable on boot", async () => {
    fetchImpl = stubFetch(jsonResponse({ message: "unavailable" }, 503));
    await restoreSession();

    expect(session.user).toBeNull();
    expect(session.restoring).toBe(false);
  });

  it("signs an existing user in and stores the user", async () => {
    fetchImpl = stubFetch(jsonResponse({ token: "tok", user }));
    await signIn("[EMAIL]", "password123");

    expect(callsTo("/api/auth/sign-in/email")).toHaveLength(1);
    expect(JSON.parse(String(callsTo("/api/auth/sign-in/email")[0]?.[1]?.body))).toEqual({
      email: "[EMAIL]",
      password: "password123",
    });
    expect(session.user).toEqual(user);
  });

  it("signs a new user up and stores the user", async () => {
    fetchImpl = stubFetch(jsonResponse({ token: "tok", user }));
    await signUp("Test User", "[EMAIL]", "password123");

    expect(callsTo("/api/auth/sign-up/email")).toHaveLength(1);
    expect(JSON.parse(String(callsTo("/api/auth/sign-up/email")[0]?.[1]?.body))).toEqual({
      name: "Test User",
      email: "[EMAIL]",
      password: "password123",
    });
    expect(session.user).toEqual(user);
  });

  it("surfaces a failed sign-in as an error the UI can show and keeps the session empty", async () => {
    fetchImpl = stubFetch(jsonResponse({ message: "Invalid email or password" }, 401));

    await expect(signIn("[EMAIL]", "wrong")).rejects.toMatchObject({
      message: "Invalid email or password",
    });
    expect(session.user).toBeNull();
  });

  it("signs out clears the session", async () => {
    session.user = user;
    fetchImpl = stubFetch(jsonResponse({ success: true }));
    await signOut();

    expect(callsTo("/api/auth/sign-out")).toHaveLength(1);
    expect(session.user).toBeNull();
  });

  it("signs out even when the server is unreachable", async () => {
    session.user = user;
    fetchImpl = stubFetch(jsonResponse({ message: "unavailable" }, 503));
    await signOut();

    expect(session.user).toBeNull();
  });

  it("shares one in-flight restore between concurrent callers", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await Promise.all([restoreSession(), restoreSession()]);

    expect(callsTo("/api/auth/get-session")).toHaveLength(1);
    expect(session.user).toEqual(user);
  });

  it("allows a later restore to re-fetch after the first completed", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await restoreSession();
    await restoreSession();

    expect(callsTo("/api/auth/get-session")).toHaveLength(2);
  });
});
