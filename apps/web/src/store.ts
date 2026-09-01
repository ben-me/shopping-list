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

  getLists(): Promise<List[]> {
    return this.lists.toArray();
  }

  getList(listId: string): Promise<List | undefined> {
    return this.lists.get(listId);
  }

  getItems(listId: string): Promise<Item[]> {
    return this.items.where("listId").equals(listId).sortBy("createdAt");
  }

  getPayments(listId: string): Promise<Payment[]> {
    return this.payments.where("listId").equals(listId).sortBy("paidAt");
  }

  getMemberships(listId: string): Promise<Membership[]> {
    return this.memberships.where("listId").equals(listId).sortBy("joinedAt");
  }

  putList(list: List): Promise<void> {
    return this.transaction("rw", this.lists, this.outbox, async () => {
      await this.lists.put(list);
      await this.queueOutboxWrite({ targetType: "list", targetId: list.id, operation: "update" });
    });
  }

  putItem(item: Item): Promise<void> {
    return this.transaction("rw", this.items, this.outbox, async () => {
      await this.items.put(item);
      await this.queueOutboxWrite({ targetType: "item", targetId: item.id, operation: "update" });
    });
  }

  putPayment(payment: Payment): Promise<void> {
    return this.transaction("rw", this.payments, this.outbox, async () => {
      await this.payments.put(payment);
      await this.queueOutboxWrite({
        targetType: "payment",
        targetId: payment.id,
        operation: "update",
      });
    });
  }

  deleteItem(id: string): Promise<void> {
    return this.transaction("rw", this.items, this.outbox, async () => {
      await this.items.delete(id);
      await this.queueOutboxWrite({ targetType: "item", targetId: id, operation: "delete" });
    });
  }

  deletePayment(id: string): Promise<void> {
    return this.transaction("rw", this.payments, this.outbox, async () => {
      await this.payments.delete(id);
      await this.queueOutboxWrite({ targetType: "payment", targetId: id, operation: "delete" });
    });
  }

  async syncMembership(membership: Membership): Promise<void> {
    await this.memberships.put(membership);
  }

  async pendingOutboxEntries(): Promise<OutboxEntry[]> {
    const rows = await this.outbox.orderBy("id").toArray();
    return rows.filter((entry) => entry.syncedAt === null);
  }

  async drainOutbox(transport: OutboxTransport): Promise<OutboxEntry[]> {
    const pendingEntries = await this.pendingOutboxEntries();
    const drainedEntries: OutboxEntry[] = [];
    for (const entry of pendingEntries) {
      await transport(entry);
      await this.outbox.update(entry.id!, { syncedAt: new Date().toISOString() });
      drainedEntries.push(entry);
    }
    return drainedEntries;
  }

  private async queueOutboxWrite(
    entry: Omit<OutboxEntry, "id" | "queuedAt" | "syncedAt">,
  ): Promise<void> {
    await this.outbox.add({ ...entry, queuedAt: new Date().toISOString(), syncedAt: null });
  }
}
