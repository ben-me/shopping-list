import { ofetch, type FetchOptions } from "ofetch";

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

type ApiErrorBody = { error?: { message?: string }; message?: string };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** One call against the hono API: session cookie included, non-2xx → ApiError. */
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
      const body = response?._data as ApiErrorBody | undefined;
      const message =
        body?.error?.message ?? body?.message ?? response?.statusText ?? "Request failed";
      throw new ApiError(response?.status ?? 0, message);
    },
  });
}
