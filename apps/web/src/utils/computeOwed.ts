import type { Owed, Payment } from "@shopping-list/api/domain";

export function computeOwed(memberIds: string[], payments: Payment[]) {
  if (memberIds.length < 2) {
    return [];
  }

  return computeBalances(memberIds, sumPayedPerMember(payments), sumOfPayments(payments));
}

export function sumOfPayments(payments: Payment[]) {
  let total = 0;
  for (const payment of payments) {
    total += payment.amountInCents;
  }
  return total;
}

export function sumPayedPerMember(payments: Payment[]) {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    totals.set(payment.memberId, (totals.get(payment.memberId) ?? 0) + payment.amountInCents);
  }
  return totals;
}

export function computeBalances(
  memberIds: string[],
  sumPayedPerMember: Map<string, number>,
  sumOfPayments: number,
): Owed[] {
  const participants = new Set([...memberIds, ...sumPayedPerMember.keys()]);
  const baseShare = Math.floor(sumOfPayments / participants.size);
  const remainder = sumOfPayments % participants.size;

  return Array.from(participants, (memberId, index) => ({
    memberId,
    amountInCents: baseShare + (index < remainder ? 1 : 0) - (sumPayedPerMember.get(memberId) ?? 0),
  }));
}
