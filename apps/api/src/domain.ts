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

export interface Owed {
  memberId: string;
  amountInCents: number;
}
