import type { Owed, Payment } from "@shopping-list/api/domain";

export function computeOwed(memberIds: string[], payments: Payment[]): Owed[] {
  const paidByMember = new Map<string, number>();
  let totalPaid = 0;

  for (const payment of payments) {
    totalPaid += payment.amountInCents;
    paidByMember.set(
      payment.memberId,
      (paidByMember.get(payment.memberId) ?? 0) + payment.amountInCents,
    );
  }

  const participantIds = [...new Set([...memberIds, ...paidByMember.keys()])];
  if (participantIds.length < 2) {
    return [];
  }

  const baseShare = Math.floor(totalPaid / participantIds.length);
  const remainder = totalPaid % participantIds.length;

  return participantIds.map((memberId, index) => ({
    memberId,
    amountInCents:
      baseShare + (index < remainder ? 1 : 0) - (paidByMember.get(memberId) ?? 0),
  }));
}
