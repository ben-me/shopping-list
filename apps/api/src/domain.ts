/**
 * Core domain **data** contract shared between the `@shopping-list/api` package
 * (the server-side source of truth) and the `@shopping-list/web` package (the
 * local-first PWA). These are the wire/data shapes only — no behaviour, no auth.
 *
 * Auth types deliberately stay out of this contract: they are owned by auth
 * code, not by the shared domain data.
 *
 * Conventions drawn from `CONTEXT.md`:
 * - Currency is EUR only; amounts are stored in minor units (cents).
 * - The concept names List, Item, Payment, Owed follow the glossary.
 */

/**
 * The rule that divides a List's total paid amount among its Members. `equal`
 * is the only rule in the MVP, but it lives as a field (ADR-0002) so future
 * rules can arrive without a schema migration.
 */
export type SplitRule = "equal";

/**
 * A shared checklist of things a household intends to buy. Owned by exactly one
 * user, who holds the power to invite and remove Members.
 */
export interface List {
  /** Stable identifier for the List. */
  id: string;
  /** The Owner who created the List. */
  ownerId: string;
  /** Human-readable name of the List. */
  name: string;
  /** How the List's total paid amount is split among its Members. */
  splitRule: SplitRule;
  /** ISO 8601 timestamp of when the List was created. */
  createdAt: string;
  /** ISO 8601 timestamp of the last change to the List. */
  updatedAt: string;
}

/**
 * A single thing on a List that someone intends to buy. Can be ticked off as
 * bought without recording any Payment — buying it and logging money are
 * unrelated acts.
 */
export interface Item {
  /** Unique identifier for the Item. */
  id: string;
  /** The List this Item belongs to. */
  listId: string;
  /** Number of the unit ("Milk", "Loaf"). */
  name: string;
  /** Whether the Item has been ticked off as bought. */
  checked: boolean;
  /** ISO 8601 timestamp of when it was ticked off, if it has been. */
  checkedAt?: string;
  /** ISO 8601 timestamp of when the Item was created. */
  createdAt: string;
  /** ISO 8601 timestamp of the last change to the Item. */
  updatedAt: string;
}

/**
 * A dated amount a Member records they paid for a List. A free-standing amount,
 * not attached to any Item. Each Payment is a single row keyed to the List. A
 * Member records and edits their own Payments, never on behalf of others.
 */
export interface Payment {
  /** Unique identifier for the Payment. */
  id: string;
  /** The List the Payment belongs to. */
  listId: string;
  /** The Member who paid and recorded the amount. */
  memberId: string;
  /** The paid amount in minor units (cents) of EUR — no float drift. */
  amountMinor: number;
  /** ISO 8601 timestamp of when the amount was paid. */
  paidAt: string;
  /** ISO 8601 timestamp of when the Payment was created. */
  createdAt: string;
  /** ISO 8601 timestamp of the last change to the Payment. */
  updatedAt: string;
}

/**
 * A Member's net position against the group — the amount they owe others
 * (positive) or are owed by them (negative). One group pot, not a pairwise
 * graph. A Member with no co-members (alone) sees only the total of Payments,
 * with no Owed figure.
 */
export interface Owed {
  /** The Member this position belongs to. */
  memberId: string;
  /** Net position in minor units (cents): positive owes the group, negative is owed by it. */
  amountMinor: number;
}
