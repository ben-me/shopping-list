import type { Payment } from "@shopping-list/api/domain";

/**
 * Equal share of the total paid per Member, aligned with `members`
 * element-for-element. A lone Member gets no share — only the total shows.
 */
export function computeSplit(members: string[], payments: Payment[]) {
  const totalInCents = payments.reduce((sum, p) => sum + p.amountInCents, 0);
  if (members.length < 2) {
    return { totalInCents, sharesInCents: [] };
  }

  const baseShare = Math.floor(totalInCents / members.length);
  const remainder = totalInCents % members.length;
  const sharesInCents = members.map((_, i) => baseShare + (i < remainder ? 1 : 0));

  return { totalInCents, sharesInCents };
}
