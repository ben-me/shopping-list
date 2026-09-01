import type { Owed, Payment } from "@shopping-list/api/domain";
import { computeSplit } from "./computeSplit";

export function computeOwed(memberIds: string[], payments: Payment[]): Owed[] {
  const { shares } = computeSplit(memberIds, payments);

  const totalsPaidByMember: Map<string, number> = new Map();
  for (const payment of payments) {
    totalsPaidByMember.set(
      payment.memberId,
      (totalsPaidByMember.get(payment.memberId) ?? 0) + payment.amountInCents,
    );
  }

  return shares.map(({ memberId, shareInCents }) => ({
    memberId,
    amountInCents: shareInCents - (totalsPaidByMember.get(memberId) ?? 0),
  }));
}
