import Dexie, { type Table } from "dexie";
import type { Item, List, Membership, Payment } from "@shopping-list/api/domain";

export type OutboxTarget = "list" | "item" | "payment";

export type OutboxOperation = "update" | "delete";

export interface OutboxEntry {
  id?: number;
  targetType: OutboxTarget;
  targetId: string;
  /** The owning List id, needed to address the server when syncing a delete. */
  listId?: string;
  operation: OutboxOperation;
  queuedAt: string;
  syncedAt: string | null;
}

export type OutboxWrite = Pick<OutboxEntry, "targetType" | "targetId" | "listId" | "operation">;

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

  getItem(id: string): Promise<Item | undefined> {
    return this.items.get(id);
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
    return this.writeWithOutbox(this.lists, () => this.lists.put(list), {
      targetType: "list",
      targetId: list.id,
      operation: "update",
    });
  }

  putItem(item: Item): Promise<void> {
    return this.writeWithOutbox(this.items, () => this.items.put(item), {
      targetType: "item",
      targetId: item.id,
      listId: item.listId,
      operation: "update",
    });
  }

  putPayment(payment: Payment): Promise<void> {
    return this.writeWithOutbox(this.payments, () => this.payments.put(payment), {
      targetType: "payment",
      targetId: payment.id,
      operation: "update",
    });
  }

  deleteItem(id: string, listId: string): Promise<void> {
    return this.writeWithOutbox(this.items, () => this.items.delete(id), {
      targetType: "item",
      targetId: id,
      listId,
      operation: "delete",
    });
  }

  deletePayment(id: string): Promise<void> {
    return this.writeWithOutbox(this.payments, () => this.payments.delete(id), {
      targetType: "payment",
      targetId: id,
      operation: "delete",
    });
  }

  /**
   * Apply a server copy of an Item to the local Store — the inbound half of a
   * Sync. Two guards keep an in-flight pull from clobbering fresher local
   * state (ADR 0001, last-write-wins per field):
   *
   * - a pending outbox delete is a tombstone: the Item stays removed even if
   *   the pull was issued before the removal and still carries the old copy;
   * - a newer local edit (still queued for Sync) beats an older server
   *   snapshot; the queued write wins on push and the echo comes back then.
   */
  async syncItem(item: Item): Promise<void> {
    const [owesDelete, local] = await Promise.all([
      this.hasPendingDelete(item.id),
      this.items.get(item.id),
    ]);
    if (owesDelete) {
      return;
    }
    if (local && local.updatedAt > item.updatedAt) {
      return;
    }
    await this.items.put(item);
  }

  /**
   * Indexed point lookup: does this Item still have an unsynced delete in
   * the outbox? The `targetId` index keeps this O(log n) per synced Item
   * instead of scanning every outbox row.
   */
  private async hasPendingDelete(itemId: string): Promise<boolean> {
    const pendingDeletes = await this.outbox
      .where("targetId")
      .equals(itemId)
      .filter(
        (entry) =>
          entry.targetType === "item" && entry.operation === "delete" && entry.syncedAt === null,
      )
      .count();
    return pendingDeletes > 0;
  }

  async syncMembership(membership: Membership): Promise<void> {
    await this.memberships.put(membership);
  }

  async syncList(list: List): Promise<void> {
    await this.lists.put(list);
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

  private writeWithOutbox<T>(
    table: Table<T, string>,
    write: () => Promise<unknown>,
    outboxWrite: OutboxWrite,
  ): Promise<void> {
    return this.transaction("rw", table, this.outbox, async () => {
      await write();
      await this.queueOutboxWrite(outboxWrite);
    });
  }

  private async queueOutboxWrite(entry: OutboxWrite): Promise<void> {
    await this.outbox.add({ ...entry, queuedAt: new Date().toISOString(), syncedAt: null });
  }
}
