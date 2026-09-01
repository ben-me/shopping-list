import type { Owed, Payment } from "@shopping-list/api/domain";

export function computeOwed(memberIds: string[], payments: Payment[]): Owed[] {
  if (memberIds.length < 2) {
    return [];
  }

  const totalPaidByMember = new Map<string, number>();
  let totalPaid = 0;
  for (const payment of payments) {
    totalPaid += payment.amountInCents;
    totalPaidByMember.set(
      payment.memberId,
      (totalPaidByMember.get(payment.memberId) ?? 0) + payment.amountInCents,
    );
  }

  const baseShare = Math.floor(totalPaid / memberIds.length);
  const remainder = totalPaid % memberIds.length;

  return memberIds.map((memberId, index) => ({
    memberId,
    amountInCents: baseShare + (index < remainder ? 1 : 0) - (totalPaidByMember.get(memberId) ?? 0),
  }));
}
