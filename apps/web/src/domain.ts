/**
 * Web-facing surface for the shared domain **data** contract.
 *
 * The web app consumes the domain shapes from the `@shopping-list/api` package
 * instead of copy-pasting them, so the server-side source of truth and the
 * local-first client stay in sync from a single definition. Only data shapes
 * live here — auth types are not part of the shared contract.
 */
export type { Item, List, Owed, Payment, SplitRule } from "@shopping-list/api/domain";
