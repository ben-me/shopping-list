import Dexie, { type Table } from "dexie";
import type { Item, List, Membership, Payment } from "@shopping-list/api/domain";

/** The record a pending outbox entry points at. Sync (issue #25) replays these
 *  against the server in the order they were queued. */
export type OutboxTarget = "list" | "item" | "payment";

export type OutboxOperation = "update" | "delete";

/**
 * One local write waiting to reach the server. The outbox makes the app never
 * depend on a live connection to accept an edit (ADR-0001): the local record is
 * written first, and its outbox entry is drained on the next Sync. `syncedAt`
 * marks the entry as delivered; `id` auto-increments so draining is strictly
 * FIFO.
 */
export interface OutboxEntry {
  id?: number;
  targetType: OutboxTarget;
  targetId: string;
  operation: OutboxOperation;
  queuedAt: string;
  syncedAt: string | null;
}

class ShoppingDb extends Dexie {
  lists!: Table<List, string>;
  items!: Table<Item, string>;
  payments!: Table<Payment, string>;
  memberships!: Table<Membership, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      lists: "id, ownerId",
      items: "id, listId",
      payments: "id, listId, memberId",
      memberships: "[listId+memberId], listId, memberId, joinedAt",
      outbox: "++id, syncedAt, targetType, targetId",
    });
  }
}

/** A function that replays one outbox entry against the server. Throwing keeps
 *  the entry pending for the next Sync. */
export type OutboxTransport = (entry: OutboxEntry) => Promise<void>;

/**
 * The local-first working copy (dexie / IndexedDB). All reads come from here,
 * never from the network; the server remains the source of truth (ADR-0001).
 * Every local write lands in the same transaction as an outbox entry, so the
 * edit is accepted offline and drains on the next Sync.
 */
export class ShoppingStore {
  private readonly db: ShoppingDb;

  constructor(name = "shopping-list") {
    this.db = new ShoppingDb(name);
  }

  // ─── Reads (never touch the network) ──────────────────────────────────────

  lists(): Promise<List[]> {
    return this.db.lists.toArray();
  }

  list(id: string): Promise<List | undefined> {
    return this.db.lists.get(id);
  }

  items(listId: string): Promise<Item[]> {
    return this.db.items.where("listId").equals(listId).sortBy("createdAt");
  }

  payments(listId: string): Promise<Payment[]> {
    return this.db.payments.where("listId").equals(listId).sortBy("paidAt");
  }

  memberships(listId: string): Promise<Membership[]> {
    return this.db.memberships.where("listId").equals(listId).sortBy("joinedAt");
  }

  // ─── Writes (accepted offline; each queues an outbox entry) ───────────────

  putList(list: List): Promise<void> {
    return this.db.transaction("rw", this.db.lists, this.db.outbox, async () => {
      await this.db.lists.put(list);
      await this.queue({ targetType: "list", targetId: list.id, operation: "update" });
    });
  }

  putItem(item: Item): Promise<void> {
    return this.db.transaction("rw", this.db.items, this.db.outbox, async () => {
      await this.db.items.put(item);
      await this.queue({ targetType: "item", targetId: item.id, operation: "update" });
    });
  }

  putPayment(payment: Payment): Promise<void> {
    return this.db.transaction("rw", this.db.payments, this.db.outbox, async () => {
      await this.db.payments.put(payment);
      await this.queue({
        targetType: "payment",
        targetId: payment.id,
        operation: "update",
      });
    });
  }

  removeItem(id: string): Promise<void> {
    return this.db.transaction("rw", this.db.items, this.db.outbox, async () => {
      await this.db.items.delete(id);
      await this.queue({ targetType: "item", targetId: id, operation: "delete" });
    });
  }

  removePayment(id: string): Promise<void> {
    return this.db.transaction("rw", this.db.payments, this.db.outbox, async () => {
      await this.db.payments.delete(id);
      await this.queue({ targetType: "payment", targetId: id, operation: "delete" });
    });
  }

  /** The server is the source of truth for Membership; this stores what a Sync
   *  delivered so the Owed calculation can run offline. */
  async putMembership(membership: Membership): Promise<void> {
    await this.db.memberships.put(membership);
  }

  // ─── Outbox ───────────────────────────────────────────────────────────────

  /** Entries waiting for the next Sync, first queued first. */
  async pendingOutbox(): Promise<OutboxEntry[]> {
    const rows = await this.db.outbox.orderBy("id").toArray();
    return rows.filter((entry) => entry.syncedAt === null);
  }

  /**
   * Replay every pending entry through `transport`, then mark each delivered
   * entry synced. The first entry whose transport throws propagates the error:
   * it (and everything after it) stays pending — its local record is kept — so
   * the next Sync retries it. Entries already drained stay marked synced.
   * Returns the entries that were drained.
   */
  async drainOutbox(transport: OutboxTransport): Promise<OutboxEntry[]> {
    const pending = await this.pendingOutbox();
    const drained: OutboxEntry[] = [];
    for (const entry of pending) {
      await transport(entry);
      await this.db.outbox.update(entry.id!, { syncedAt: new Date().toISOString() });
      drained.push(entry);
    }
    return drained;
  }

  private async queue(entry: Omit<OutboxEntry, "id" | "queuedAt" | "syncedAt">): Promise<void> {
    await this.db.outbox.add({
      ...entry,
      queuedAt: new Date().toISOString(),
      syncedAt: null,
    });
  }
}
