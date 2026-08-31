export type SplitRule = "equal";

export interface List {
  id: string;
  ownerId: string;
  name: string;
  splitRule: SplitRule;
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

export interface Owed {
  memberId: string;
  amountInCents: number;
}
