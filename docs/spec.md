# Spec — Shared Shopping List with Expense Splitting (MVP)

## Problem Statement

A household needs to keep track of what it intends to buy and how much each person has spent or owes, without anyone having to carry a calculator or settle informal debts in memory. When we shop offline — at the store with no wifi — the app must keep working on the last-synced data, and changes made offline must reach everyone else once a connection returns.

Today there is no app for this: the household default is separate notes, group chats, and mental arithmetic over who paid for the milk.

## Solution

A progressive web app a household signs into. Each member can create **Lists** of **Items** they intend to buy, invite other members by email, and check items off. Any member can record a **Payment** — a free dated amount in EUR, not tied to any item. The app divides the total paid evenly across members and shows each person their **Owed** figure: how much they owe the group (red) or are owed by it (green). Everything works offline and syncs when back online; a single shared server is the source of truth.

## User Stories

**Lists & items**
1. As a user, I want to create a shopping list, so that I have a shared place to collect what my household intends to buy.
2. As a user, I want to add items to a list, so that I can record what we intend to buy.
3. As a user, I want to remove an item from a list, so that I can drop something I no longer need.
4. As a user, I want to check an item off the list when it's bought, so that my household sees we got it.
5. As a user, I want to uncheck an item, so that I can correct a mistaken tick.
6. As a user, I want to tick items off while offline at the store, so that my tick is captured even with no wifi and syncs later.
7. As a user, I want the list to work with no connection using last-synced data, so that shopping in a signal-free store is never blocked.

**Membership & invitations**
8. As the owner of a list, I want to invite another user by email, so that my household can edit the same list.
9. As a user, I want to receive a join request by email, so that I know I've been invited and can accept.
10. As the owner of a list, I want to remove a member, so that I can stop someone editing.
11. As a member, I want every member (including the owner) to have equal edit rights, so that no one needs special permission to do the obvious thing.
12. As a user, when a member leaves, I want their recorded payments to be left untouched, so that past spending history is preserved and the remaining members' split simply re-divides.

**Payments & money**
13. As a member, I want to record a payment against a list with an amount and a date, so that I can log what I paid.
14. As a member, I want my payment to be a free amount not tied to any item, so that I don't have to attribute the register total to individual products.
15. As a member, I want to edit my own payment's amount and date, so that I can fix a typo or correct a fat-fingered entry.
16. As a member, I want to delete my own payment, so that I can remove an entry I entered by mistake.
17. As a member, I want the app to store money in EUR only, so that I never juggle currencies or conversion rates.
18. As a member, I want the app to treat each payment as an independent row, so that sync never tries to merge or dedupe my payments.

**Split & owed**
19. As a member, I want the app to split the list's total paid evenly across all members, so that I know my fair share without arithmetic.
20. As a member, I want to see how much I owe the group (in red), so that I know what to hand over.
21. As a member, I want to see how much the group owes me (in green), so that I know what I'm owed.
22. As a member of a list where I'm alone, I want to see only the running total of payments, with no owed figure, so that the UI isn't showing me an empty debt.
23. As a member, I want the owed figure to be a single group net, so that debts don't chase each other pair-by-pair around the house.

## Implementation Decisions

This spec synthesises `CONTEXT.md` and ADRs `0001` and `0002`.

- **Architecture.** Vue 3 (vite, router) client. `hono` exposes the HTTP API. `better-auth` handles authentication against a `sqlite` store. `dexie.js` is the local-first IndexedDB layer on the device. The client and server are separated; the device holds a working copy, the server is the source of truth (ADR `0001`).
- **Local-first, offline-priority sync.** The app reads from dexie and works fully with zero network, using last-synced data. Local writes queue on the device; on reconnect the client uploads its pending patch and the server responds with the accumulated remote state. Editing offline is never blocked.
- **No dedupe / no merge on sync.** Two members adding "the same" item offline both persist — the app treats them as two real events, not one to collapse. Payments are independent rows and never merged. Item and payment edits converge on last-write-wins per field (ADR `0001`).
- **Schema.** The server keeps sqlite tables for Users, Lists, Memberships, Invitations, Items, and Payments. A Payment is a row with an amount (in EUR minor units), a date, the paying member, and the list it belongs to — nothing more. There is no per-item pricing, no currency column, no conversion tables.
- **Split.** Equal is the only implemented rule, but `splitRule` is carried as a field on the List so other splits can slot in later without a data migration (ADR `0002`).
- **Owed calculation.** For each member, `Owed = (total paid ÷ member count) − (member's contributed total)`. Positive means they owe the group (red); negative means the group owes them (green). It is a single pooled pot, never a pairwise graph. With no co-members, the app shows only the running total and no Owed figure.
- **Membership.** The Owner is also a Member and has no privileged edit rights beyond creating the list and managing membership. Invitations are delivered by email only — the sole outbound notification in the MVP; there is no push, no digest, no SMS.
- **Money handling.** EUR only. Amounts are stored in minor units (cents) to avoid float drift. No multi-currency, no conversion, no per-list currency setting.
- **PWA.** The app is installable and offline-capable; the offline path is what guarantees the store scenario keeps working with no wifi.
- **Out-of-scope guardrails.** No per-item cost, no scanning, no recipes/nutrition, no permission tiers, no settlement flow (members only add and edit their own payments), no multiple pots per list, no list templates, no push.

## Testing Decisions

- **What makes a good test:** test observable behaviour through the public surface, not implementation internals. For the client, assert what the user sees and can do (state changes on tick, owed figure correctness, offline write captured). For the API, assert the request/response contract.
- **Modules to test:**
  - **Owed/split logic** — the calculation is pure and is the single most important correctness seam; test equal-split values, the green/red sign convention, the alone case, and the leave/re-divides case.
  - **API contract (hono)** — list/item/payment CRUD, membership and invitation endpoints, auth via better-auth; test each endpoint's behaviour and error responses.
  - **Dexie store layer** — verify offline writes queue locally and sync patches to the server on reconnect, and that last-write-wins edits and no-dedupe-adds behave as decided.
  - **PWA/UI** — offline behaviour (app usable with no network on last-synced data) and the owed display (red/green). e2e uses Playwright; unit uses Vitest (both already configured).
- **Prior art:** the repo has a Vitest setup (`src/__tests__`) and a Playwright e2e (`e2e/`) — the App component test and the "visits the app root" spec are the existing patterns to extend.

## Out of Scope

- Per-item pricing and item-level expense attribution — payments are pot-level only.
- Multiple currencies, conversion, or a currency setting — EUR only.
- Scanning products, nutrition, recipes, unit/spend history per item.
- Permission tiers or roles beyond Owner vs Member — all members edit everything equally.
- A settlement flow — members can only add and edit their own payments for the MVP.
- Multiple balance pots or separate money sources per list — exactly one pot.
- Recurring lists or list templates.
- Push notifications, digests, or any outbound notification other than the invite email.
- Device-authoritative sync or any conflict-resolution UI — sync is server-authoritative with no merge/dedupe.

## Further Notes

- "Balance" in the everyday sense is deliberately split into the recorded **Payment** (a free amount + date) and the computed **Owed** figure. They are different concepts and are treated as such everywhere in the model (see `CONTEXT.md`).
- Authentication (better-auth) gates membership and ownership, but the offline path must never depend on an active network to function.
- The Owed figure is a group net, computed live from payments and membership; it is not stored.
