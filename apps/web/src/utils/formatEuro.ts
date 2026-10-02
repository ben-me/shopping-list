/**
 * Money as the household reads it: euro, German formatting, no decimals of
 * our own — `Intl` owns the separators and the trailing symbol so every screen
 * renders a figure the same way. The formatter is built once, because
 * `Intl.NumberFormat` is expensive to construct and these run on every row.
 */
const euroFormat = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function formatEuro(cents: number): string {
  return euroFormat.format(cents / 100);
}
