import "fake-indexeddb/auto";

vi.mock(
  "../auth-client",
  async () => await import("./mocks/auth-client").then((m) => m.makeAuthClientMock()),
);

import { jsonResponse, settle } from "./support/app";
import { db } from "../db";
import * as storeOwner from "../store-owner";
import {
  _resetSession,
  bootSession,
  isSignUpOpen,
  session,
  signIn,
  signOut,
  signUp,
  type SessionUser,
} from "../session";

const user: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "[EMAIL]",
  emailVerified: true,
  image: null,
};

function stubFetch(response: Response) {
  const fetchImpl = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

/** Simulates the network being down: the fetch itself fails. */
function stubUnreachableFetch() {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function callsTo(path: string) {
  return fetchImpl.mock.calls.filter(([url]) => String(url).includes(path));
}

let fetchImpl: ReturnType<typeof stubFetch>;

afterEach(() => {
  vi.unstubAllGlobals();
  _resetSession();
  localStorage.clear();
});

describe("session", () => {
  it("restores the signed-in user from the server on boot", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await bootSession();

    expect(callsTo("/api/auth/get-session")).toHaveLength(1);
    expect(session.user).toEqual(user);
  });

  it("treats a missing session as signed out", async () => {
    fetchImpl = stubFetch(jsonResponse(null));
    await bootSession();

    expect(session.user).toBeNull();
  });

  it("keeps the app signed out when the server is unreachable on boot with no cached user", async () => {
    fetchImpl = stubFetch(jsonResponse({ message: "unavailable" }, 503));
    await bootSession();

    expect(session.user).toBeNull();
  });

  it("falls back to the cached user when the server is unreachable, so the app still opens offline", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await bootSession();
    expect(session.user).toEqual(user);
    expect(callsTo("/api/auth/get-session")).toHaveLength(1);

    // Now the network dies: the fetch itself fails rather than the server
    // answering "no session".
    fetchImpl = stubUnreachableFetch();
    _resetSession();
    await bootSession();

    expect(callsTo("/api/auth/get-session")).toHaveLength(1);
    expect(session.user).toEqual(user);
  });

  it("does not resurrect a cached user the server has signed out", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await bootSession();

    // The server is reachable and says there is no session: reachability
    // wins, so neither the mirror nor the cache survives the boot.
    fetchImpl = stubFetch(jsonResponse(null));
    _resetSession();
    await bootSession();

    expect(session.user).toBeNull();
    expect(localStorage.getItem("shopping-list:session-user")).toBeNull();

    // A later offline boot therefore stays signed out too.
    fetchImpl = stubUnreachableFetch();
    _resetSession();
    await bootSession();

    expect(session.user).toBeNull();
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

  it("signs out clears the session, the cached user, and every row in the local Store", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await bootSession();
    await db.syncList({
      id: "list-1",
      ownerId: user.id,
      name: "Mine",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await db.getLists()).toHaveLength(1);
    fetchImpl = stubFetch(jsonResponse({ success: true }));
    await signOut();

    expect(callsTo("/api/auth/sign-out")).toHaveLength(1);
    expect(session.user).toBeNull();
    expect(localStorage.getItem("shopping-list:session-user")).toBeNull();
    expect(await db.getLists()).toEqual([]);
  });

  it("wipes the previous user's local data when a different user signs in", async () => {
    const secondUser: SessionUser = { id: "user-2", name: "Second User", email: "[EMAIL]" };
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await bootSession();
    await db.syncList({
      id: "list-1",
      ownerId: user.id,
      name: "Mine",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await db.getLists()).toHaveLength(1);

    // A different user signs in: wiped before any view could paint it.
    fetchImpl.mockImplementation(async () => jsonResponse({ token: "tok", user: secondUser }));
    await signIn("[EMAIL]", "password123");

    expect(session.user).toEqual(secondUser);
    expect(await db.getLists()).toEqual([]);
  });

  it("keeps the Store when the same user opens the app again on the device", async () => {
    // No recorded account yet, and a pre-fix install's rows already on disk:
    // the first boot must keep them, not wipe what it cannot attribute.
    const mine = {
      id: "list-backstop",
      ownerId: user.id,
      name: "Mine",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await db.syncList(mine);
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));

    await bootSession();
    expect(await db.getLists()).toContainEqual(mine);

    // The device hand-over backstop runs again on the next boot and must
    // recognise this user as the one who owns the Store.
    _resetSession();
    await bootSession();

    expect(await db.getLists()).toContainEqual(mine);
  });

  it("signs out even when the server is unreachable — and still wipes the Store", async () => {
    session.user = user;
    await db.syncList({
      id: "list-1",
      ownerId: user.id,
      name: "Mine",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    fetchImpl = stubFetch(jsonResponse({ message: "unavailable" }, 503));
    await signOut();

    expect(session.user).toBeNull();
    expect(await db.getLists()).toEqual([]);
  });

  it("shares one boot between concurrent callers", async () => {
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));
    await Promise.all([bootSession(), bootSession()]);

    expect(callsTo("/api/auth/get-session")).toHaveLength(1);
    expect(session.user).toEqual(user);
  });

  it("still restores the session when scoping the Store fails", async () => {
    const spy = vi
      .spyOn(storeOwner, "ensureStoreForUser")
      .mockRejectedValue(new Error("IndexedDB unavailable"));
    fetchImpl = stubFetch(jsonResponse({ session: { token: "tok" }, user }));

    await expect(bootSession()).resolves.toBeUndefined();

    expect(session.user).toEqual(user);
    spy.mockRestore();
  });

  it("reports the one-time bootstrap gate, defaulting to closed when unreachable", async () => {
    fetchImpl = stubFetch(jsonResponse({ signUpOpen: true }));
    expect(await isSignUpOpen()).toBe(true);
    expect(callsTo("/api/signup-status")).toHaveLength(1);

    fetchImpl = stubUnreachableFetch();
    expect(await isSignUpOpen()).toBe(false);
  });

  it("a boot fetch superseded by a sign-in cannot clobber the fresh session", async () => {
    // The boot fetch hangs; while it is in flight the user signs in.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionCalls = 0;
    fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/get-session")) {
        sessionCalls += 1;
        if (sessionCalls === 1) {
          await gate;
          return jsonResponse(null);
        }
        return jsonResponse({ session: { token: "tok" }, user });
      }
      if (url.includes("/api/auth/sign-in/email")) {
        return jsonResponse({ token: "tok", user });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const boot = bootSession();
    await signIn("[EMAIL]", "password123");
    expect(session.user).toEqual(user);

    // The stale boot fetch lands saying signed-out: the atom already
    // cancelled it (sign-in triggered the superseding fetch), so it must not
    // undo the sign-in.
    release();
    await boot;
    await settle();

    expect(session.user).toEqual(user);
    expect(JSON.parse(String(localStorage.getItem("shopping-list:session-user")))).toEqual(user);
  });

  it("a boot fetch superseded by a sign-out cannot resurrect the session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionCalls = 0;
    fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/get-session")) {
        sessionCalls += 1;
        if (sessionCalls === 1) {
          await gate;
          return jsonResponse({ session: { token: "tok" }, user });
        }
        return jsonResponse(null);
      }
      if (url.includes("/api/auth/sign-out")) {
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const boot = bootSession();
    await signOut();
    expect(session.user).toBeNull();

    // The stale boot fetch lands claiming the user is still signed in: the
    // atom cancelled it, so it must not undo the sign-out.
    release();
    await boot;
    await settle();

    expect(session.user).toBeNull();
    expect(localStorage.getItem("shopping-list:session-user")).toBeNull();
  });
});
