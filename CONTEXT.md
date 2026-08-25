# Shopping List

A progressive web app for a household to share what they need to buy and keep track of who paid what, so shopping costs can be split fairly.

## Language

**List**:
A shared checklist of things a household intends to buy. Owned by exactly one user.
_Avoid_: Grocery list, checklist (when meaning the shared object), workspace

**Item**:
A single thing on a ShoppingList that someone intends to buy. Can be checked off as bought without recording any Payment — buying it and logging money are unrelated acts.
_Avoid_: Product, entry, line

**Checking Off (Tick)**:
Marking an Item as bought on the List. Independent of recording a Payment.
_Avoid_: Buying, completing, marking done

**Owner**:
The user who created a ShoppingList and holds the power to invite and remove others.
_Avoid_: Admin, creator, host

**Member**:
A user who has been invited to (and joined) a ShoppingList and can edit its items. The Owner is also a Member.
_Avoid_: Invitee, contributor, editor, guest

**Invitation**:
A pending offer for a user to join a ShoppingList as a Member. Distinct from Membership — an Invitation is not yet a Member.
_Avoid_: Invite, share link, request

**Payment**:
A dated amount a Member records they paid for a ShoppingList. Not attached to any Item — it is a free amount standing alone. A Member can add and edit their own Payments, but cannot record on behalf of others or settle. Each Payment is a single row in the sqlite table keyed to the List.
_Avoid_: Balance entry, expense, transaction, receipt, amount (when meaning the record), paid entry

**Currency**:
EUR is the only currency in the app. Amounts are stored in minor units (cents) to avoid float drift; there is no multi-currency, conversion, or per-list currency choice.
_Avoid_: money, cash, conversion, default currency setting

**Invitation (email)**:
An Invitation is delivered by email. In the MVP the only outbound notification is the invite email; there are no push notifications.
_Avoid_: push alert, digest email

**Split**:
The rule that divides a ShoppingList's total paid amount among its Members. Equal across Members is the only rule in the MVP; support for other rules is deferred but the design leaves room for them.
_Avoid_: Share, fair division, 50/50 (when meaning the general rule)

**Split (equal)**:
The MVP's split rule: each Member's share is the total paid divided evenly across all Members. Payment amounts can be edited by the Member who recorded them.
_Avoid_: 50/50

**Remaining Members**:
After a Member leaves or is removed, their recorded Payments stay in the list and are not recalculated or forgiven. The split simply continues to divide the total by the Members who remain.
_Avoid_: former member share, forgiven debt, rebalancing

**Owed (Settlement)**:
A Member's net position against the group — the amount they owe others (positive) or are owed by them (negative). One group pot, not a pairwise graph. A Member with no co-members (alone) sees only the total of Payments, with no Owed figure.
_Avoid_: Balance, debt, credit, owes, payment
graph

**Sync**:
Bringing a List's locally-recorded changes up to the server and pulling remote changes down. Happens when a device goes back online.
_Avoid_: Merge, reconcile, sync-up/sync-down (implying both), update

**Offline Mode**:
The app staying fully usable with the last-synced data when there is no network. Offline edits are held on the device until the next sync.
_Avoid_: Incognito, airplane mode, cached mode

**Duplicate**:
Two records of the same intended thing that both persist rather than being merged, because the app does not reconcile them. A deliberate consequence of offline-first.
_Avoid_: conflict (when merged), merge, duplicate-tolerance