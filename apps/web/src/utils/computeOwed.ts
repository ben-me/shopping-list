import type { Owed, Payment } from "@shopping-list/api/domain";

export function computeOwed(memberIds: string[], payments: Payment[]): Owed[] {
  if (memberIds.length < 2) {
    return [];
  }

  const paidByMember = new Map<string, number>();
  let totalPaid = 0;

  for (const payment of payments) {
    totalPaid += payment.amountInCents;
    paidByMember.set(
      payment.memberId,
      (paidByMember.get(payment.memberId) ?? 0) + payment.amountInCents,
    );
  }

  const participantIds = new Set(memberIds);
  for (const payer of paidByMember.keys()) {
    participantIds.add(payer);
  }

  const baseShare = Math.floor(totalPaid / participantIds.size);
  const remainder = totalPaid % participantIds.size;

  const result: Owed[] = [];
  let shareIndex = 0;
  for (const memberId of participantIds) {
    const shareInCents = baseShare + (shareIndex < remainder ? 1 : 0);
    shareIndex += 1;
    result.push({
      memberId,
      amountInCents: shareInCents - (paidByMember.get(memberId) ?? 0),
    });
  }

  return result;
}