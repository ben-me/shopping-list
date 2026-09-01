import type { Payment } from "@shopping-list/api/domain";

export interface SplitShare {
  memberId: string;
  shareInCents: number;
}

export interface SplitResult {
  totalInCents: number;
  shares: SplitShare[];
}

export function computeSplit(memberIds: string[], payments: Payment[]): SplitResult {
  const totalInCents = payments.reduce((sum, payment) => sum + payment.amountInCents, 0);

  if (memberIds.length < 2) {
    return { totalInCents, shares: [] };
  }

  const baseShare = Math.floor(totalInCents / memberIds.length);
  const remainder = totalInCents % memberIds.length;
  const shares = memberIds.map((memberId, index) => ({
    memberId,
    shareInCents: baseShare + (index < remainder ? 1 : 0),
  }));

  return { totalInCents, shares };
}
