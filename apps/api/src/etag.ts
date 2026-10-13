import type { AppContext } from "./http";

const encoder = new TextEncoder();

/**
 * Answer a read from the caller's own copy of it: the same rows come back as a
 * `304` with no body, changed rows as JSON plus an `ETag` to send back as
 * `If-None-Match`.
 *
 * The tag hashes the rows rather than a column some write path would have to
 * remember to bump, and hashes them sorted, so the order a query happens to
 * return rows in cannot wobble it.
 */
export async function readRows(c: AppContext, key: string, rows: unknown[]): Promise<Response> {
  const tag = `"${await fingerprint(rows)}"`;
  if (matchesTag(c.req.header("if-none-match"), tag)) {
    return c.body(null, 304, { ETag: tag });
  }
  return c.json({ [key]: rows }, 200, { ETag: tag });
}

async function fingerprint(rows: unknown[]): Promise<string> {
  const canonical = rows
    .map((row) => JSON.stringify(row))
    .sort()
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function matchesTag(ifNoneMatch: string | undefined, tag: string): boolean {
  return (ifNoneMatch ?? "")
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === tag);
}
