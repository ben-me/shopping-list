import { session, restoreSession, signIn, signOut, signUp, type SessionUser } from "../session";

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

function resetSession() {
  localStorage.clear();
  Object.assign(session, { user: null, restoring: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
});

describe("session", () => {
  it("restores the signed-in user from the server on boot", async () => {
    const fetchImpl = stubFetch(jsonResponse({ user }));
    await restoreSession();

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/get-session",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(session.user).toEqual(user);
    expect(session.restoring).toBe(false);
  });

  it("treats a missing session as signed out", async () => {
    stubFetch(jsonResponse({}));
    await restoreSession();

    expect(session.user).toBeNull();
    expect(session.restoring).toBe(false);
  });

  it("keeps the app usable when the server is unreachable on boot", async () => {
    stubFetch(new Response(null, { status: 503 }));
    await restoreSession();

    expect(session.user).toBeNull();
    expect(session.restoring).toBe(false);
  });

  it("signs an existing user in and stores the the user", async () => {
    const fetchImpl = stubFetch(jsonResponse({ token: "tok", user }));
    await signIn("[EMAIL]", "password123");

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/sign-in/email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "[EMAIL]", password: "password123" }),
        credentials: "include",
      }),
    );
    expect(session.user).toEqual(user);
  });

  it("signs a new user up and stores the the user", async () => {
    const fetchImpl = stubFetch(jsonResponse({ token: "tok", user }));
    await signUp("Test User", "[EMAIL]", "password123");

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/sign-up/email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Test User", email: "[EMAIL]", password: "password123" }),
      }),
    );
    expect(session.user).toEqual(user);
  });

  it("surfaces a failed sign-in as an error the UI can show and keeps the session empty", async () => {
    stubFetch(jsonResponse({ message: "Invalid email or password" }, 401));

    await expect(signIn("[EMAIL]", "wrong")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Invalid email or password",
    });
    expect(session.user).toBeNull();
  });

  it("signs out clears the session", async () => {
    session.user = user;
    const fetchImpl = stubFetch(jsonResponse({}));
    await signOut();

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({ method: "POST" }),
    );
    expect(session.user).toBeNull();
  });

  it("signs out even when the server is unreachable", async () => {
    session.user = user;
    stubFetch(new Response(null, { status: 503 }));
    await signOut();

    expect(session.user).toBeNull();
  });

  it("restores the cached session when the server is unreachable", async () => {
    localStorage.setItem("shopping-list.session-user", JSON.stringify(user));
    stubFetch(new Response(null, { status: 503 }));
    await restoreSession();

    expect(session.user).toEqual(user);
    expect(session.restoring).toBe(false);
  });

  it("signing in caches the user for offline reloads", async () => {
    stubFetch(jsonResponse({ token: "tok", user }));
    await signIn("[EMAIL]", "password123");

    expect(localStorage.getItem("shopping-list.session-user")).toEqual(JSON.stringify(user));
  });

  it("signing out clears the cached session", async () => {
    localStorage.setItem("shopping-list.session-user", JSON.stringify(user));
    session.user = user;
    stubFetch(jsonResponse({}));
    await signOut();

    expect(localStorage.getItem("shopping-list.session-user")).toBeNull();
  });
});
