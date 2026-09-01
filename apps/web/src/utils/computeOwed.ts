import type { Owed, Payment, SplitRule } from "@shopping-list/api/domain";
import { computeSplit } from "./computeSplit";

/**
 * Each current Member's net position against the group, under the List's split
 * rule. A Member's Owed figure is their equal share of the pot minus what they
 * actually paid (positive = they owe the group, red; negative = the group owes
 * them, green; one pooled pot, never pairwise). Recomputed from the same
 * `computeSplit`, so it always agrees with `Split` and re-divides automatically
 * when a Member leaves.
 */
export function computeOwed(splitRule: SplitRule, members: string[], payments: Payment[]): Owed[] {
  const { shares } = computeSplit(splitRule, members, payments);

  const paidBy: Map<string, number> = new Map();
  for (const p of payments) {
    paidBy.set(p.memberId, (paidBy.get(p.memberId) ?? 0) + p.amountInCents);
  }

  return shares.map(({ memberId, shareInCents }) => ({
    memberId,
    amountInCents: shareInCents - (paidBy.get(memberId) ?? 0),
  }));
}
