import { provisionUser } from "../provision";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi(handler: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn<typeof fetch>(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      return handler(url, init);
    },
  );
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provisionUser", () => {
  it("creates an email-verified user through the admin route", async () => {
    stubApi((url, init) => {
      expect(url).toBe("/api/auth/admin/create-user");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(
        JSON.stringify({
          name: "Partner",
          email: "partner@example.com",
          password: "password-123",
          role: "user",
          data: { emailVerified: true },
        }),
      );
      return jsonResponse({ user: { id: "user-2" } });
    });

    await provisionUser("Partner", "partner@example.com", "password-123");
  });

  it("surfaces the server's rejection message when the account is not created", async () => {
    stubApi(() => jsonResponse({ message: "User already exists" }, 400));

    await expect(
      provisionUser("Partner", "partner@example.com", "password-123"),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "User already exists",
    });
  });
});
