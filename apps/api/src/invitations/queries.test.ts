import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createD1Connection, type Db } from "../db";
import { createList } from "../lists/queries";
import { runMigrations, startMiniflare } from "../test-support";
import * as invitationsQueries from "./queries";

describe("invitations query helpers", () => {
  let mf: Miniflare;
  let db: Db;

  beforeAll(async () => {
    mf = await startMiniflare("local-d1-invitations-queries-db");
    const devDb = await mf.getD1Database("devDb");
    await runMigrations(devDb);
    db = createD1Connection(devDb);
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates, reads, updates, and deletes Invitation rows with a pending default", async () => {
    const list = await createList(db, { ownerId: "u-owner", name: "Shop" });
    const invitation = await invitationsQueries.createInvitation(db, {
      listId: list.id,
      email: "[EMAIL]",
      invitedById: "u-owner",
      token: "tok-secret",
    });

    expect(invitation.status).toBe("pending");
    expect(invitation.token).toBe("tok-secret");
    await expect(invitationsQueries.getInvitation(db, invitation.id)).resolves.toEqual(invitation);

    const updated = await invitationsQueries.updateInvitation(db, invitation.id, {
      status: "accepted",
    });
    expect(updated?.status).toBe("accepted");

    const invitations = await invitationsQueries.getInvitationsByList(db, list.id);
    expect(invitations.map((i) => i.id)).toContain(invitation.id);

    await expect(invitationsQueries.deleteInvitation(db, invitation.id)).resolves.toBe(true);
  });
});
