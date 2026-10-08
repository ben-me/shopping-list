import { defineRelations } from "drizzle-orm";
import * as tables from "./schema";

/**
 * drizzle-orm 1.0 relational API (v2). Keys come from the shorthand table
 * names, so relation names match the exported table names in `./schema`.
 */
export const relations = defineRelations(tables, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    ownedLists: r.many.lists(),
    memberships: r.many.memberships(),
    issuedInvitations: r.many.invitations(),
    payments: r.many.payments(),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id }),
  },
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id }),
  },
  lists: {
    owner: r.one.user({ from: r.lists.ownerId, to: r.user.id }),
    memberships: r.many.memberships(),
    invitations: r.many.invitations(),
    items: r.many.items(),
    payments: r.many.payments(),
  },
  memberships: {
    list: r.one.lists({ from: r.memberships.listId, to: r.lists.id }),
    member: r.one.user({ from: r.memberships.memberId, to: r.user.id }),
  },
  invitations: {
    list: r.one.lists({ from: r.invitations.listId, to: r.lists.id }),
    invitedBy: r.one.user({ from: r.invitations.invitedById, to: r.user.id }),
  },
  items: {
    list: r.one.lists({ from: r.items.listId, to: r.lists.id }),
  },
  payments: {
    list: r.one.lists({ from: r.payments.listId, to: r.lists.id }),
    member: r.one.user({ from: r.payments.memberId, to: r.user.id }),
  },
}));
