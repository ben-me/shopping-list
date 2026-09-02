import { ofetch, type FetchOptions } from "ofetch";

type ApiErrorBody = { error?: { message?: string }; message?: string };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions<"json"> = {},
): Promise<T> {
  return ofetch<T>(path, {
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
