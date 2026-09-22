import type { Hono } from "hono";
import type { AuthEnv } from "./auth";
import { createD1Connection } from "./db";
import { BadRequestError } from "./errors";
import type { AppContext, AppVariables } from "./guards";

/** The one Hono app every slice registers its routes on. */
export type App = Hono<{ Bindings: AuthEnv; Variables: AppVariables }>;

export type { AppContext };

export function getRequestContext(c: AppContext) {
  return {
    db: createD1Connection(c.env.devDb),
    listId: c.req.param("listId") ?? "",
    itemId: c.req.param("itemId") ?? "",
    paymentId: c.req.param("paymentId") ?? "",
    invitationId: c.req.param("invitationId") ?? "",
  };
}

export async function readJsonBody(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new BadRequestError("A JSON body is required");
  }
}
