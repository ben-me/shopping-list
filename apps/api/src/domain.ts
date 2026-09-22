export interface List {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  listId: string;
  name: string;
  checked: boolean;
  checkedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  listId: string;
  memberId: string;
  amountInCents: number;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  listId: string;
  memberId: string;
  joinedAt: string;
}

/**
 * One person with access to a List — the Owner or a joined Member — with the
 * name the client shows in "who has access". The Owner always comes first,
 * with the List's creation time as their joinedAt.
 */
export interface MemberDetails {
  memberId: string;
  name: string;
  joinedAt: string;
}

export type InvitationStatus = "pending" | "accepted" | "revoked";

/**
 * An in-app offer for an existing user to join a List (ADR 0003). Not yet a
 * Member; delivered in-app — no email, no join link.
 */
export interface Invitation {
  id: string;
  listId: string;
  email: string;
  invitedById: string;
  status: InvitationStatus;
  token: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An Invitation as it appears on a List to its Members: the invitee's email,
 * who sent it, and its status. The `token` stays server-side — the in-app
 * flow never needs it (ADR 0003).
 */
export interface ListInvitation {
  id: string;
  listId: string;
  email: string;
  invitedById: string;
  invitedByName: string;
  status: InvitationStatus;
  createdAt: string;
}

/**
 * A pending Invitation as it appears in the invitee's inbox: which List and
 * which Owner invited them, with accept/decline handled by id. The invited
 * email is the invitee's own, so it is not repeated here.
 */
export interface PendingInvitation {
  id: string;
  listId: string;
  listName: string;
  invitedById: string;
  invitedByName: string;
  createdAt: string;
}

export interface Owed {
  memberId: string;
  amountInCents: number;
}

/** Sync upsert fields (ADR 0001): per-field reconcile; id from the URL, timestamps server-stamped. */
export type ItemUpdate = Partial<Pick<Item, "name" | "checked" | "checkedAt">>;

export type PaymentUpdate = Partial<Pick<Payment, "amountInCents" | "paidAt">>;
