import { formatEuro } from "./formatEuro";

/**
 * How a screen words an Owed figure. A Members row speaks in the third person
 * and carries the figure inside the wording ("owes 1,00"); the Payments footer
 * speaks to you and shows the figure beside the wording ("You owe" 1,00). The
 * figure always arrives as a positive amount.
 */
interface OwedVoice {
  owes: (figureInCents: number) => string;
  owed: (figureInCents: number) => string;
  settled: string;
}

/** One signed Owed figure, read for one screen: the wording, the figure, the colour. */
interface OwedPresentation {
  /** What the screen prints. */
  label: string;
  /** The formatted figure beside the wording; none when settled. */
  figure: string | null;
  /** The class that colours the row: "owes" red, "owed" green, "settled" muted. */
  className: string;
}

/** What a signed Owed figure says: the Member owes the group, is owed, or stands settled. */
function owedLabel(amountInCents: number, voice: OwedVoice): string {
  if (amountInCents > 0) {
    return voice.owes(amountInCents);
  }
  if (amountInCents < 0) {
    return voice.owed(-amountInCents);
  }
  return voice.settled;
}

/** The colour the same sign wears: red owes the group, green is owed, muted settled. */
function owedClassName(amountInCents: number): string {
  if (amountInCents > 0) {
    return "owes";
  }
  if (amountInCents < 0) {
    return "owed";
  }
  return "settled";
}

/** The figure beside the wording, or none when there is nothing owed either way. */
function owedFigure(amountInCents: number): string | null {
  return amountInCents === 0 ? null : formatEuro(Math.abs(amountInCents));
}

/**
 * One Owed figure, read once for whichever screen is showing it: a Member's
 * Share row and the Payments footer all mean the same thing by a positive
 * figure (they owe the group), a negative one (the group owes them) and zero
 * (settled up) — only the wording differs, and each screen supplies its own
 * voice. Pure: the same figure always reads the same way.
 */
export function owedPresentation(amountInCents: number, voice: OwedVoice): OwedPresentation {
  return {
    label: owedLabel(amountInCents, voice),
    figure: owedFigure(amountInCents),
    className: owedClassName(amountInCents),
  };
}
