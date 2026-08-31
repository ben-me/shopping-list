/**
 * The API client for the hono backend. Every request carries the session
 * cookie (`credentials: "include"`), speaks JSON, and surfaces any non-2xx
 * response as an `ApiError` — the one error shape the UI handles.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const options: RequestInit = {
      method,
      credentials: "include",
      headers: { Accept: "application/json" },
    };
    if (body !== undefined) {
      options.headers = { ...options.headers, "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }

    const response = await fetchImpl(`${baseUrl}${path}`, options);

    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: (path: string) => request<void>("DELETE", path),
  };
}

/** Read the error envelope (issue #22) and fall back to the status text. */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const message =
    (body as { error?: { message?: string }; message?: string })?.error?.message ??
    (body as { message?: string })?.message ??
    response.statusText;
  return new ApiError(response.status, message || response.statusText, body);
}
