import Dexie, { type Table } from "dexie";
import type { Item, List, Membership, Payment } from "@shopping-list/api/domain";

export type OutboxTarget = "list" | "item" | "payment";

export type OutboxOperation = "update" | "delete";

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

export type OutboxTransport = (entry: OutboxEntry) => Promise<void>;

export class ShoppingStore {
  private readonly db: ShoppingDb;

  constructor(name = "shopping-list") {
    this.db = new ShoppingDb(name);
  }

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

  /** Stored from a Sync; not queued in the outbox — the server owns Membership. */
  async syncMembership(membership: Membership): Promise<void> {
    await this.db.memberships.put(membership);
  }

  async pendingOutbox(): Promise<OutboxEntry[]> {
    const rows = await this.db.outbox.orderBy("id").toArray();
    return rows.filter((entry) => entry.syncedAt === null);
  }

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
