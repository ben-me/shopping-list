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
