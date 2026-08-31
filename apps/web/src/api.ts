import { ofetch, type FetchOptions } from "ofetch";

/**
 * The API client for the hono backend, as one small function you can use
 * anywhere in the web app.
 *
 * Every request goes through ofetch with:
 * - `credentials: "include"` so the session cookie set by better-auth is always
 *   sent (dev runs web and api on different ports, i.e. different origins — this
 *   is what makes authed calls work there; on a same-origin deployment it is a
 *   no-op).
 * - a base URL from `VITE_API_BASE_URL` (set it to the Worker origin in dev, or
 *   when web and api live on different domains); unset means same-origin.
 * - non-2xx responses mapped to an `ApiError`, reading the server's error
 *   envelope (issue #22) so the UI has one error shape to show. Network
 *   failures keep ofetch's own `FetchError`.
 *
 * Objects passed as `body` are JSON-serialised and sent with
 * `content-type: application/json`; 204 responses resolve to `undefined`.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions<"json"> = {},
): Promise<T> {
  return ofetch<T>(path, {
    baseURL: API_BASE_URL,
    credentials: "include",
    ...options,
    onResponseError(context) {
      const response = context.response;
      const body = (response?._data ?? undefined) as
        | { error?: { message?: string }; message?: string }
        | undefined;
      const message =
        body?.error?.message ?? body?.message ?? response?.statusText ?? "Request failed";
      throw new ApiError(response?.status ?? 0, message);
    },
  });
}
