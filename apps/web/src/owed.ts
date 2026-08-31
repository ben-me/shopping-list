import type { Payment, SplitRule } from "@shopping-list/api/domain";

/**
 * One Member's position within a List's split: their exact equal share of the
 * pot, what they actually paid, and their net Owed figure.
 */
export interface MemberSplit {
  memberId: string;
  /** Exact equal share in cents. The remainder of total ÷ member count is
   *  spread one cent at a time over the members in the order given, so shares
   *  always sum exactly to the total — no float drift, no lost cents. */
  shareInCents: number;
  /** What this Member paid, in cents. */
  paidInCents: number;
  /** share − paid. Positive means the Member owes the group (red); negative
   *  means the group owes them (green). One pooled pot, never pairwise. */
  owedInCents: number;
}

export interface SplitResult {
  /** The pot: sum of every Payment on the List, including Payments recorded by
   *  Members who have since left (their spending is not forgiven or
   *  recalculated — only the divide changes). */
  totalInCents: number;
  /** True when the List has fewer than two Members: only the total shows, with
   *  no Owed figure. */
  alone: boolean;
  /** One row per current Member, in the order `members` was given. Empty when
   *  `alone`. */
  members: MemberSplit[];
}

/**
 * Divide a List's pot among its current Members. `payments` must be scoped to
 * the one List; `members` must be the current Member ids in a stable order
 * (e.g. by joinedAt). The rule comes from the List (`splitRule`) so a second
 * rule can slot in later without a data migration (ADR-0002); equal is the only
 * rule implemented in the MVP.
 */
export function computeSplit(
  splitRule: SplitRule,
  members: string[],
  payments: Payment[],
): SplitResult {
  const totalInCents = payments.reduce((sum, p) => sum + p.amountInCents, 0);
  const memberCount = members.length;
  const alone = memberCount < 2;

  if (splitRule !== "equal") {
    // The type union only ships "equal" today; a future rule must be handled
    // here rather than silently falling into the equal math.
    throw new Error(`split rule not implemented: ${splitRule}`);
  }

  if (alone) {
    return { totalInCents, alone, members: [] };
  }

  const baseShare = Math.floor(totalInCents / memberCount);
  const remainder = totalInCents % memberCount;

  const paidBy = new Map<string, number>();
  for (const p of payments) {
    paidBy.set(p.memberId, (paidBy.get(p.memberId) ?? 0) + p.amountInCents);
  }

  const membersSplit = members.map((memberId, index) => {
    const shareInCents = baseShare + (index < remainder ? 1 : 0);
    const paidInCents = paidBy.get(memberId) ?? 0;
    return {
      memberId,
      shareInCents,
      paidInCents,
      owedInCents: shareInCents - paidInCents,
    };
  });

  return { totalInCents, alone, members: membersSplit };
}
