/**
 * Shared scaffolding for the component specs.
 *
 * Every screen spec used to carry its own copy of the same four helpers: a
 * JSON response builder, a timer tick, a `fetch` stub written as a chain of
 * `if (url === ...)` branches, and a mount that opens the app on a route. That
 * is a lot of noise around the one thing a spec is actually about, and the
 * inline fetch chains were the most branchy code in the test suite.
 *
 * `stubApi` takes a route table instead: a spec states the routes it cares
 * about, and anything else fails loudly with the method and path, so a
 * forgotten route shows up as a clear error instead of a silent hang.
 */
import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import type { List } from "@shopping-list/api/domain";
import App from "../../App.vue";
import { db } from "../../db";
import { createAppRouter } from "../../router";
import { _resetSession, type SessionUser } from "../../session";

export type RouteBody = Record<string, unknown> | null;
/** A route answers with a body, a ready-made `Response`, a function of the request, or a promise of any of those. */
export type RouteReply =
  | RouteBody
  | Response
  | Promise<RouteBody | Response>
  | ((init: RequestInit | undefined) => RouteBody | Response | Promise<RouteBody | Response>);
/**
 * Keyed by `"METHOD /path"`, or by `"/path"` to answer any method. A key may
 * end in `*` to match a path prefix, which is how a spec acknowledges the
 * queued outbox writes a Sync pass drains.
 */
export type RouteTable = Record<string, RouteReply>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Lets the timers the app schedules (Sync, debounced fetches) run out. */
export function settle(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The reply for an unreachable server: a 503 with no body. */
export const serverDown = () => new Response(null, { status: 503 });

async function toResponse(reply: RouteReply, init: RequestInit | undefined): Promise<Response> {
  const body = typeof reply === "function" ? reply(init) : reply;
  // A reply may resolve later (a gated session fetch, say) — await it first.
  const settled = body instanceof Promise ? await body : body;
  return settled instanceof Response ? settled : jsonResponse(settled);
}

function lookup(table: RouteTable, method: string, url: string): RouteReply | undefined {
  const calls = [`${method} ${url}`, url];
  for (const call of calls) {
    const exact = table[call];
    if (exact !== undefined) {
      return exact;
    }
  }
  for (const call of calls) {
    for (const [key, reply] of Object.entries(table)) {
      if (key.endsWith("*") && call.startsWith(key.slice(0, -1))) {
        return reply;
      }
    }
  }
  return undefined;
}

export interface StubApiOptions {
  /** The signed-in session the app boots with. */
  user?: SessionUser | null;
  /** Answers for every route the table does not name — an unreachable server, say. */
  fallback?: RouteReply;
}

/**
 * Stubs global `fetch` with the given route table. A spec that needs the
 * session to change mid-test (sign-in, sign-out) overrides
 * `GET /api/auth/get-session` in the table; a spec about offline behaviour
 * passes a `fallback` instead of naming every route.
 */
/** One request the stub answered, in the shape a spec asserts the server contract with. */
export interface RecordedRequest {
  method: string;
  url: string;
  body: string | undefined;
}

/**
 * Stubs global `fetch` with the given route table. A spec that needs the
 * session to change mid-test (sign-in, sign-out) overrides
 * `GET /api/auth/get-session` in the table; a spec about offline behaviour
 * passes a `fallback` instead of naming every route.
 *
 * Returns the requests it answered, in order, so a spec can assert the exact
 * server contract rather than only what came back.
 */
export function stubApi(routes: RouteTable = {}, options: StubApiOptions = {}) {
  const user = options.user ?? null;
  const table: RouteTable = { ...routes };
  const requests: RecordedRequest[] = [];
  // The default session answer never overrules a spec that names the route.
  if (!("/api/auth/get-session" in table) && !("GET /api/auth/get-session" in table)) {
    table["GET /api/auth/get-session"] = () => (user ? { user } : {});
  }

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({ method, url, body: init?.body as string | undefined });
      const reply = lookup(table, method, url) ?? options.fallback;
      if (reply === undefined) {
        throw new Error(`No stub for ${method} ${url}`);
      }
      return toResponse(reply, init);
    }),
  );
  return { requests };
}

/** Opens the app on `path` behind a memory router, the way a visit would. */
export async function mountApp(path: string) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();
  return { wrapper: mount(App, { global: { plugins: [router] } }), router };
}

/** Wipes the local Store and the session so every spec starts from the same disk. */
export async function resetStore(lists: List[] = []) {
  await db.clearAll();
  for (const list of lists) {
    await db.syncList(list);
  }
  _resetSession();
}
