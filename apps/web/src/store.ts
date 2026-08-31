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

export type OutboxTransport = (entry: OutboxEntry) => Promise<void>;

export class ShoppingDb extends Dexie {
  lists!: Table<List, string>;
  items!: Table<Item, string>;
  payments!: Table<Payment, string>;
  memberships!: Table<Membership, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor(name = "shopping-list") {
    super(name);
    this.version(1).stores({
      lists: "id, ownerId",
      items: "id, listId, createdAt",
      payments: "id, listId, memberId, paidAt",
      memberships: "[listId+memberId], listId, memberId, joinedAt",
      outbox: "++id, syncedAt, targetType, targetId",
    });
  }

  allLists(): Promise<List[]> {
    return this.lists.toArray();
  }

  getList(id: string): Promise<List | undefined> {
    return this.lists.get(id);
  }

  listItems(listId: string): Promise<Item[]> {
    return this.items.where("listId").equals(listId).sortBy("createdAt");
  }

  listPayments(listId: string): Promise<Payment[]> {
    return this.payments.where("listId").equals(listId).sortBy("paidAt");
  }

  listMemberships(listId: string): Promise<Membership[]> {
    return this.memberships.where("listId").equals(listId).sortBy("joinedAt");
  }

  putList(list: List): Promise<void> {
    return this.transaction("rw", this.lists, this.outbox, async () => {
      await this.lists.put(list);
      await this.queue({ targetType: "list", targetId: list.id, operation: "update" });
    });
  }

  putItem(item: Item): Promise<void> {
    return this.transaction("rw", this.items, this.outbox, async () => {
      await this.items.put(item);
      await this.queue({ targetType: "item", targetId: item.id, operation: "update" });
    });
  }

  putPayment(payment: Payment): Promise<void> {
    return this.transaction("rw", this.payments, this.outbox, async () => {
      await this.payments.put(payment);
      await this.queue({ targetType: "payment", targetId: payment.id, operation: "update" });
    });
  }

  removeItem(id: string): Promise<void> {
    return this.transaction("rw", this.items, this.outbox, async () => {
      await this.items.delete(id);
      await this.queue({ targetType: "item", targetId: id, operation: "delete" });
    });
  }

  removePayment(id: string): Promise<void> {
    return this.transaction("rw", this.payments, this.outbox, async () => {
      await this.payments.delete(id);
      await this.queue({ targetType: "payment", targetId: id, operation: "delete" });
    });
  }

  /** Server-owned; written by a Sync, never queued in the outbox. */
  async syncMembership(membership: Membership): Promise<void> {
    await this.memberships.put(membership);
  }

  async pendingOutbox(): Promise<OutboxEntry[]> {
    const rows = await this.outbox.orderBy("id").toArray();
    return rows.filter((entry) => entry.syncedAt === null);
  }

  async drainOutbox(send: OutboxTransport): Promise<OutboxEntry[]> {
    const pending = await this.pendingOutbox();
    const drained: OutboxEntry[] = [];
    for (const entry of pending) {
      await send(entry);
      await this.outbox.update(entry.id!, { syncedAt: new Date().toISOString() });
      drained.push(entry);
    }
    return drained;
  }

  private async queue(entry: Omit<OutboxEntry, "id" | "queuedAt" | "syncedAt">): Promise<void> {
    await this.outbox.add({ ...entry, queuedAt: new Date().toISOString(), syncedAt: null });
  }
}
