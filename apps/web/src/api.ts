import { ofetch, type FetchOptions } from "ofetch";

type ApiErrorBody = { error?: { message?: string }; message?: string };

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function requestOptions(options: FetchOptions<"json">): FetchOptions<"json"> {
  return {
    credentials: "include",
    retry: 0,
    ...options,
    onResponseError(context) {
      const response = context.response;
      const body = response?._data as ApiErrorBody | undefined;
      const message =
        body?.error?.message ?? body?.message ?? response?.statusText ?? "Request failed";
      throw new ApiError(response?.status ?? 0, message);
    },
  };
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions<"json"> = {},
): Promise<T> {
  return ofetch<T>(path, requestOptions(options));
}

/** What the device remembers about a read: the payload the server sent and the tag it came with. */
interface HeldRead {
  tag: string;
  body: unknown;
}

const heldReads = new Map<string, HeldRead>();

/**
 * A read the server can answer "unchanged" to. The device remembers the last
 * tag per path and sends it as `If-None-Match`, so a poll that changes nothing
 * costs a `304` with no body, and `modified: false` tells the caller it already
 * holds `body` and has nothing to rewrite.
 */
export async function readIfModified<T>(
  path: string,
): Promise<{ modified: boolean; body: T | undefined }> {
  const held = heldReads.get(path);
  const response = await ofetch.raw<T>(
    path,
    requestOptions({ headers: held ? { "if-none-match": held.tag } : undefined }),
  );
  if (response.status === 304 && held) {
    return { modified: false, body: held.body as T };
  }
  const tag = response.headers.get("etag");
  if (tag) {
    heldReads.set(path, { tag, body: response._data });
  }
  return { modified: true, body: response._data };
}

/**
 * Forget what the device remembers about reads: all of them, or one List's. A
 * remembered payload is only good while the rows it describes are still in the
 * Store, so whoever drops those rows drops the tag with them.
 */
export function forgetReads(listId?: string): void {
  if (listId === undefined) {
    heldReads.clear();
    return;
  }
  for (const path of heldReads.keys()) {
    if (path.includes(listId)) {
      heldReads.delete(path);
    }
  }
}
