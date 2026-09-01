import type { Payment, SplitRule } from "@shopping-list/api/domain";

export interface SplitShare {
  memberId: string;
  /** This Member's equal share of the pot, exact, in cents. */
  shareInCents: number;
}

export interface Split {
  /** The pot: every Payment on the List, including those a departed Member
   *  recorded — their spending is never forgiven or recalculated, only the
   *  divide changes (see CONTEXT.md, "Remaining Members"). */
  totalInCents: number;
  /** One share per current Member, in the order `members` was given. Empty
   *  when fewer than two Members — a lone Member sees only the total. */
  shares: SplitShare[];
}

/**
 * Divide a List's pot among its current Members under the List's split rule
 * (the rule comes from `List.splitRule`, ADR-0002; "equal" is the only rule in
 * the MVP, anything else is rejected rather than silently mis-divided).
 *
 * Equal split, one cent exact: the total is floor-divided by the number of
 * Members, and the leftover cents are handed out one per Member starting at
 * the first, so `shares` always sums exactly to `totalInCents` — no float
 * drift, no lost cents. With 100¢ over 3 Members that is [34, 33, 33].
 *
 * `payments` must be scoped to the one List and `members` must be the current
 * Member ids in a stable order (e.g. by `joinedAt`).
 */
export function computeSplit(
  splitRule: SplitRule,
  members: string[],
  payments: Payment[],
): Split {
  const totalInCents = payments.reduce((sum, p) => sum + p.amountInCents, 0);

  // The type union only ships "equal" today; a future rule must be handled
  // here rather than silently falling into the equal math (ADR-0002).
  if (splitRule !== "equal") {
    throw new Error(`split rule not implemented: ${splitRule}`);
  }

  if (members.length < 2) {
    return { totalInCents, shares: [] };
  }

  const baseShare = Math.floor(totalInCents / members.length);
  const remainder = totalInCents % members.length;
  const shares = members.map((memberId, index) => ({
    memberId,
    shareInCents: baseShare + (index < remainder ? 1 : 0),
  }));

  return { totalInCents, shares };
}