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

/**
 * A User's membership of one List. `memberId` is a User id — a Member is a User
 * who belongs to the List's group; the List's `ownerId` (see `List`) is who
 * created it, and the Owner is also a Member. Membership answers "who are the
 * current Members of this List?", which is the group the Split divides the pot
 * over, and "which Lists does this User see?" — it does not express ownership.
 * One row per (listId, memberId); the same User can be a Member of many Lists.
 */
export interface Membership {
  listId: string;
  memberId: string;
  joinedAt: string;
}

/**
 * One Member's net position against the group: their equal share minus what
 * they paid. Positive means the Member owes the group (red); negative means
 * the group owes the Member (green). One pool, never pairwise. A lone Member
 * has no Owed figure — only the List's total shows.
 */
export interface Owed {
  memberId: string;
  amountInCents: number;
}
