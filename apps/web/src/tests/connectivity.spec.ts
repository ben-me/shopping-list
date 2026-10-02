import "fake-indexeddb/auto";

import type { List } from "@shopping-list/api/domain";
import { db } from "../db";
import { addItem } from "../items";
import { onSyncPass, online, runSyncPass, startSyncWatcher, SYNC_POLL_MS } from "../connectivity";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Record every request the sync makes so tests can assert the exact server
 * contract. The default handler answers any Item PUT with the server's
 * canonical echo of the write.
 */
function stubServer(
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined,
) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input: string | URL | Request, init?) => {
    const url = typeof input === "string" ? input : String(input);
    requests.push({ url, init });
    const handled = await handler?.(url, init);
    if (handled) {
      return handled;
    }
    if (init?.method === "PUT" && url.includes("/items/")) {
      return jsonResponse({ item: { ...JSON.parse(String(init.body)), updatedAt: "server" } });
    }
    throw new Error(`No stub for ${url} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { requests, fetchImpl };
}

let stopWatch: (() => void) | null = null;

function watch(): () => void {
  stopWatch = startSyncWatcher(db);
  return stopWatch;
}

/**
 * Install the watcher with only the interval timer faked, so its poll can be
 * driven on demand while every other timer — and the async Sync pass a tick
 * starts — stays real.
 */
function watchWithPoll(): () => void {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  return watch();
}

/** Run the watcher's pending poll: one sweep at the production poll interval. */
async function tickPoll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SYNC_POLL_MS);
  vi.useRealTimers();
}

beforeEach(async () => {
  await db.lists.clear();
  await db.items.clear();
  await db.payments.clear();
  await db.outbox.clear();
  await db.syncList(list);
  online.value = true;
});

afterEach(() => {
  stopWatch?.();
  stopWatch = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startSyncWatcher", () => {
  it("drains queued writes to the server when the connection returns, with no user action", async () => {
    stubServer(() => new Response(null, { status: 503 }));
    const item = await addItem(db, list.id, "Milk");
    await db.putItem({ ...item, checked: true, checkedAt: new Date().toISOString() });

    // Still offline: the write stays queued.
    expect(await db.pendingOutboxEntries()).toHaveLength(2);

    const { requests } = stubServer();
    watch();

    // The browser announces the connection is back…
    window.dispatchEvent(new Event("online"));

    // …and the watcher has drained the queue with no user action.
    await vi.waitFor(async () => {
      await expect(await db.pendingOutboxEntries()).toHaveLength(0);
    });

    const put = requests.find((r) => r.init?.method === "PUT");
    expect(put?.url).toBe(`/api/lists/${list.id}/items/${item.id}`);
    expect(JSON.parse((put?.init?.body as string) ?? "{}")).toMatchObject({
      name: "Milk",
      checked: true,
    });
  });

  it("keeps syncing silently: a failed reconnect drain leaves the queue for the next attempt", async () => {
    stubServer(() => new Response(null, { status: 503 }));
    await addItem(db, list.id, "Milk");
    stubServer(() => new Response(null, { status: 503 }));
    watch();

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(async () => {
      await expect(fetch).toHaveBeenCalled();
    });

    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("mirrors the browser's connection state into the online flag", () => {
    watch();

    window.dispatchEvent(new Event("offline"));
    expect(online.value).toBe(false);

    window.dispatchEvent(new Event("online"));
    expect(online.value).toBe(true);
  });

  it("stops syncing after the returned cleanup runs", async () => {
    stubServer(() => new Response(null, { status: 503 }));
    await addItem(db, list.id, "Milk");
    const { fetchImpl } = stubServer(() => new Response(null, { status: 503 }));
    const stop = watch();
    stop();

    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await db.pendingOutboxEntries()).toHaveLength(1);
  });

  it("prunes synced outbox rows past the retention window after a successful drain", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    // The pending row needs a target the device still holds, or the drain has
    // nothing to send for it and drops it as unsent rather than synced.
    await db.putItem({
      id: "pending-1",
      listId: list.id,
      name: "Milk",
      checked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.outbox.bulkAdd([
      {
        targetType: "item",
        targetId: "stale-1",
        operation: "update",
        queuedAt: stale,
        syncedAt: stale,
      },
    ]);
    // The server still returns the List, so only the pruning is under test.
    stubServer((url) => (url === "/api/lists" ? jsonResponse({ lists: [list] }) : undefined));

    await runSyncPass(db);

    const remaining = await db.outbox.toArray();
    expect(remaining.map((entry) => entry.targetId)).toEqual(["pending-1"]);
  });

  it("fans out to per-view syncs after the shared drain and pull", async () => {
    const { requests } = stubServer((url) =>
      url === "/api/lists" ? jsonResponse({ lists: [] }) : undefined,
    );
    let viewSyncCalls = 0;
    const stopViewSync = onSyncPass(async () => {
      viewSyncCalls += 1;
    });
    watch();

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => {
      expect(viewSyncCalls).toBe(1);
    });

    // The shared pull (Lists) happened before the per-view sync.
    const get = requests.find((r) => r.init?.method === undefined || r.init?.method === "GET");
    expect(get?.url).toBe("/api/lists");
    stopViewSync();
  });

  it("a list-scoped pass drains and fans out but skips the app-wide Lists pull", async () => {
    const { requests } = stubServer((url) =>
      url === "/api/lists" ? jsonResponse({ lists: [] }) : undefined,
    );
    let viewSyncCalls = 0;
    let globalSyncCalls = 0;
    const stopViewSync = onSyncPass(async () => {
      viewSyncCalls += 1;
    });
    const stopGlobalSync = onSyncPass(
      async () => {
        globalSyncCalls += 1;
      },
      { globalOnly: true },
    );

    await runSyncPass(db, "list");

    expect(requests.some((r) => r.url === "/api/lists")).toBe(false);
    expect(viewSyncCalls).toBe(1);
    expect(globalSyncCalls).toBe(0);
    stopViewSync();
    stopGlobalSync();
  });

  it("widens a queued rerun to global when a global pass waits behind a list pass", async () => {
    // A gate keeps the first (list-scoped) pass in flight until released.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { requests } = stubServer(async () => {
      await gate;
      return jsonResponse({ lists: [] });
    });

    const first = runSyncPass(db, "list");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = runSyncPass(db); // global: must widen the queued rerun
    release?.();
    await Promise.all([first, second]);

    // The rerun ran as a global pass: the Lists index was pulled at least once.
    expect(requests.filter((r) => r.url === "/api/lists")).toHaveLength(1);
  });

  it("polls the server periodically while online and visible, with no user action", async () => {
    const { requests } = stubServer((url) =>
      url === "/api/lists" ? jsonResponse({ lists: [] }) : undefined,
    );
    watchWithPoll();

    await tickPoll();

    await vi.waitFor(() => {
      expect(requests.some((r) => r.url === "/api/lists")).toBe(true);
    });
  });

  it("does not poll while offline", async () => {
    const { requests } = stubServer((url) =>
      url === "/api/lists" ? jsonResponse({ lists: [] }) : undefined,
    );
    watchWithPoll();
    // Drop the connection after the watcher mirrored navigator.onLine.
    online.value = false;

    await tickPoll();
    // Real time passes with nothing started: no pass reaches the server.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(requests.some((r) => r.url === "/api/lists")).toBe(false);
  });

  it("collapses concurrent reconnect triggers into one pass — the outbox drains once", async () => {
    stubServer(() => new Response(null, { status: 503 }));
    const item = await addItem(db, list.id, "Milk");
    const { requests } = stubServer();
    watch();

    // Two triggers land in the same tick (e.g. `online` racing a visibility
    // change): the second must collapse into the pass already running.
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));

    await vi.waitFor(async () => {
      await expect(await db.pendingOutboxEntries()).toHaveLength(0);
    });

    const puts = requests.filter((r) => r.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toBe(`/api/lists/${list.id}/items/${item.id}`);
  });

  it("queues a pass requested while another is in flight and awaits the combined run", async () => {
    // A gated server keeps the first pass in flight until the test releases it.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await addItem(db, list.id, "Milk");
    const { requests } = stubServer(async () => {
      await gate;
      return jsonResponse({ lists: [] });
    });
    watch();

    window.dispatchEvent(new Event("online")); // pass A: stuck on its first request
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A user-triggered pass while A is running queues a rerun and waits for
    // the combined run — it is never silently dropped.
    let resolved = false;
    const awaiting = runSyncPass(db).then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolved).toBe(false); // still held by pass A

    release?.();
    await awaiting;

    await vi.waitFor(async () => {
      await expect(await db.pendingOutboxEntries()).toHaveLength(0);
    });
    // The outbox drained exactly once across the pair — the queued rerun
    // finds nothing left to send.
    expect(requests.filter((r) => r.init?.method === "PUT")).toHaveLength(1);
  });
});
