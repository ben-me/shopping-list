/**
 * Which marker pen a List is written in.
 *
 * A pad's pen is drawn from the six in the token palette, once, and kept for
 * its whole life, so a List can be picked out at a glance on the home and
 * keeps the same pen across devices and reloads. The draw is a hash of the
 * List's id: no user data, no server round-trip, stable everywhere the id is.
 */

export interface ListColors {
  /** The pen's full colour, as a var() reference ready to bind into CSS. */
  accent: string;
  /** The pen's soft shade — ink bled into paper — for fills behind text. */
  soft: string;
}

const PENS = 6;

export function listColors(seed: string): ListColors {
  const pen = penOf(seed);
  return {
    accent: `var(--palette-${pen})`,
    soft: `var(--palette-${pen}-soft)`,
  };
}

/** A fixed, portable hash of the seed, mapped onto pen number 1..PENS. */
function penOf(seed: string): number {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) & 0x7fffffff;
  }
  return (hash % PENS) + 1;
}
