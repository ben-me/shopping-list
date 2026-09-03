import type { Owed, Payment } from "@shopping-list/api/domain";

export interface OwedResult {
  totalInCents: number;
  shareInCents: number | null;
  owed: Owed[];
}

export function computeOwed(memberIds: string[], payments: Payment[]): OwedResult {
  const totalInCents = sumPaid(payments);

  if (memberIds.length < 2) {
    return { totalInCents, shareInCents: null, owed: [] };
  }

  return {
    totalInCents,
    shareInCents: Math.floor(totalInCents / memberIds.length),
    owed: owedFigures(memberIds, sumPaidPerMember(payments), totalInCents),
  };
}

function sumPaid(payments: Payment[]): number {
  let total = 0;
  for (const payment of payments) {
    total += payment.amountInCents;
  }
  return total;
}

function sumPaidPerMember(payments: Payment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    totals.set(payment.memberId, (totals.get(payment.memberId) ?? 0) + payment.amountInCents);
  }
  return totals;
}

function owedFigures(
  memberIds: string[],
  paidPerMember: Map<string, number>,
  totalInCents: number,
): Owed[] {
  const baseShare = Math.floor(totalInCents / memberIds.length);
  const remainder = totalInCents % memberIds.length;

  return memberIds.map((memberId, index) => ({
    memberId,
    amountInCents: baseShare + (index < remainder ? 1 : 0) - (paidPerMember.get(memberId) ?? 0),
  }));
}
