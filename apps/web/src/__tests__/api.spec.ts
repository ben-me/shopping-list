import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../api";
import type { List } from "@shopping-list/api/domain";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  splitRule: "equal",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("carries the session cookie on every request", async () => {
    const fetchImpl = stubFetch(jsonResponse([]));

    await apiFetch("/lists");

    expect(fetchImpl).toHaveBeenCalledWith(
      "/lists",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns the parsed JSON of a 2xx response", async () => {
    stubFetch(jsonResponse(list));

    await expect(apiFetch<List>("/lists/list-1")).resolves.toEqual(list);
  });

  it("maps a non-2xx response to an ApiError the UI can show", async () => {
    stubFetch(jsonResponse({ error: { message: "Not a member of this list" } }, 403));

    const error = await apiFetch("/lists/list-1").catch((e: unknown) => e);

    expect(error).toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Not a member of this list",
    });
  });

  it("JSON-stringifies an object body and sets the JSON content type", async () => {
    const fetchImpl = stubFetch(jsonResponse(list, 201));

    await apiFetch("/lists", { method: "POST", body: { name: "Household" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [unknown, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "Household" }));
    expect((init.headers as Headers).get("content-type")).toContain("application/json");
  });

  it("treats a 204 as no content", async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(apiFetch("/lists/list-1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
