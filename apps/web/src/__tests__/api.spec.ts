import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api";
import type { List } from "@shopping-list/api/domain";

const list: List = {
  id: "list-1",
  ownerId: "user-1",
  name: "Household",
  splitRule: "equal",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("carries the session cookie on every request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([list]));
    const client = createApiClient("http://api.test", fetchImpl);

    await client.get<List[]>("/lists");

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/lists",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns the parsed JSON of a 2xx response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(list));
    const client = createApiClient("http://api.test", fetchImpl);

    await expect(client.get<List>("/lists/list-1")).resolves.toEqual(list);
  });

  it("maps a non-2xx response to an error the UI can show", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { message: "Not a member of this list" } }, 403),
    );
    const client = createApiClient("http://api.test", fetchImpl);

    await expect(client.get("/lists/list-1")).rejects.toMatchObject({
      status: 403,
      message: "Not a member of this list",
    });
  });

  it("sends a JSON body and content type on POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(list, 201));
    const client = createApiClient("http://api.test", fetchImpl);

    await client.post<List>("/lists", { name: "Household" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/lists",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: "Household" }),
      }),
    );
  });

  it("treats a 204 as no content", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createApiClient("http://api.test", fetchImpl);

    await expect(client.delete("/lists/list-1")).resolves.toBeUndefined();
  });
});
