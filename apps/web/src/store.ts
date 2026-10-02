import Dexie, { type Table } from "dexie";
import type { Item, List, Membership, Payment } from "@shopping-list/api/domain";
import now from "./utils/now";

export type OutboxTarget = "list" | "item" | "payment";

/** A Member's display name, keyed by Member id — the Owner's lives here too. */
export interface MemberName {
  memberId: string;
  name: string;
}

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

type OutboxWrite = Pick<OutboxEntry, "targetType" | "targetId" | "listId" | "operation">;

/**
 * Sends one entry and reports what it did: `true` once the write reached the
 * server, `false` when the device no longer holds the target and there was
 * nothing left to send. A transport that resolves cannot mean both.
 */
export type OutboxTransport = (entry: OutboxEntry) => Promise<boolean>;

/**
 * Synced rows are kept this long, then pruned: they are the only local record
 * that an offline write made it, and the table grows by one row per write.
 */
export const OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export class ShoppingDb extends Dexie {
  lists!: Table<List, string>;
  items!: Table<Item, string>;
  payments!: Table<Payment, string>;
  memberships!: Table<Membership, string>;
  memberNames!: Table<MemberName, string>;
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
    // A v1 Store gains the table empty and fills it on its next Sync.
    this.version(2).stores({ memberNames: "memberId" });
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

  getPayment(id: string): Promise<Payment | undefined> {
    return this.payments.get(id);
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
      listId: payment.listId,
      operation: "update",
    });
  }

  /**
   * Tick or un-tick an Item: a command, not a patch. Reads the row inside the
   * transaction that writes it, so two taps in a row cannot both build on the
   * same stale copy and undo each other. Never touches a Payment.
   */
  async setItemChecked(id: string, listId: string, checked: boolean): Promise<Item> {
    const timestamp = now();
    return this.transaction("rw", this.items, this.outbox, async () => {
      const current = await this.items.get(id);
      if (!current || current.listId !== listId) {
        throw new Error(`No Item ${id} in List ${listId}`);
      }
      const updated: Item = {
        ...current,
        checked,
        checkedAt: checked ? timestamp : undefined,
        updatedAt: timestamp,
      };
      await this.items.put(updated);
      await this.queueOutboxWrite({
        targetType: "item",
        targetId: id,
        listId,
        operation: "update",
      });
      return updated;
    });
  }

  /**
   * Edit a Payment: a command, for the same reason as {@link setItemChecked}.
   * Only the fields given are touched; everything else is read from the row.
   */
  async updatePayment(
    id: string,
    listId: string,
    edit: { amountInCents?: number; paidAt?: string },
  ): Promise<Payment> {
    return this.transaction("rw", this.payments, this.outbox, async () => {
      const current = await this.payments.get(id);
      if (!current || current.listId !== listId) {
        throw new Error(`No Payment ${id} in List ${listId}`);
      }
      const updated: Payment = { ...current, ...edit, updatedAt: now() };
      await this.payments.put(updated);
      await this.queueOutboxWrite({
        targetType: "payment",
        targetId: id,
        listId,
        operation: "update",
      });
      return updated;
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

  deletePayment(id: string, listId: string): Promise<void> {
    return this.writeWithOutbox(this.payments, () => this.payments.delete(id), {
      targetType: "payment",
      targetId: id,
      listId,
      operation: "delete",
    });
  }

  /**
   * Apply a server copy of an Item. Last-write-wins (ADR 0001), with a pending
   * delete as a tombstone and a newer local edit beating an older server copy.
   */
  async syncItem(item: Item): Promise<void> {
    const [owesDelete, local] = await Promise.all([
      this.hasPendingDelete("item", item.id),
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

  /** A server copy of a Payment, with the same guards as {@link syncItem}. */
  async syncPayment(payment: Payment): Promise<void> {
    const [owesDelete, local] = await Promise.all([
      this.hasPendingDelete("payment", payment.id),
      this.payments.get(payment.id),
    ]);
    if (owesDelete) {
      return;
    }
    if (local && local.updatedAt > payment.updatedAt) {
      return;
    }
    await this.payments.put(payment);
  }

  /** Indexed lookup, so a synced row costs O(log n) rather than a table scan. */
  private async hasPendingDelete(targetType: OutboxTarget, targetId: string): Promise<boolean> {
    const pendingDeletes = await this.outbox
      .where("targetId")
      .equals(targetId)
      .filter(
        (entry) =>
          entry.targetType === targetType &&
          entry.operation === "delete" &&
          entry.syncedAt === null,
      )
      .count();
    return pendingDeletes > 0;
  }

  async syncMembership(membership: Membership): Promise<void> {
    await this.memberships.put(membership);
  }

  /** Last write wins, so a Sync pass refreshes names. */
  async putMemberNames(names: MemberName[]): Promise<void> {
    await this.memberNames.bulkPut(names);
  }

  /** Every name the device holds, keyed by Member id. */
  async getMemberNames(): Promise<Record<string, string>> {
    return Object.fromEntries(
      (await this.memberNames.toArray()).map((row) => [row.memberId, row.name]),
    );
  }

  /** The one write that skips the outbox: Memberships only change server-side. */
  async replaceMemberships(listId: string, memberships: Membership[]): Promise<void> {
    await this.transaction("rw", this.memberships, async () => {
      await this.memberships.where("listId").equals(listId).delete();
      for (const membership of memberships) {
        await this.memberships.put(membership);
      }
    });
  }

  async syncList(list: List): Promise<void> {
    await this.lists.put(list);
  }

  async pendingOutboxEntries(): Promise<OutboxEntry[]> {
    const rows = await this.outbox.orderBy("id").toArray();
    return rows.filter((entry) => entry.syncedAt === null);
  }

  /**
   * Send everything queued and mark it sent. Writes to the same target collapse
   * into one send — the transport reads the target's current state, so five
   * taps would send five identical payloads. A failed send marks none of them,
   * so the whole group is retried. Groups keep the order they were queued in.
   *
   * A group the transport had nothing to send for is dropped rather than
   * stamped: a `syncedAt` is the record that a write reached the server, and
   * nothing did. Retrying would not help either — the target is gone, and the
   * write that removed it is queued right behind.
   */
  async drainOutbox(transport: OutboxTransport): Promise<OutboxEntry[]> {
    const pendingEntries = await this.pendingOutboxEntries();
    const drainedEntries: OutboxEntry[] = [];
    for (const group of groupPendingEntries(pendingEntries)) {
      const keys = group.map((entry) => entry.id!);
      if (!(await transport(group[group.length - 1]!))) {
        await this.outbox.bulkDelete(keys);
        continue;
      }
      await this.outbox.bulkUpdate(
        keys.map((key) => ({ key, changes: { syncedAt: new Date().toISOString() } })),
      );
      drainedEntries.push(...group);
    }
    return drainedEntries;
  }

  /** Pending rows stay: IndexedDB leaves `null` out of the index, so this stays a bounded scan. */
  async pruneSyncedOutbox(): Promise<void> {
    const cutoff = new Date(Date.now() - OUTBOX_RETENTION_MS).toISOString();
    await this.outbox.where("syncedAt").belowOrEqual(cutoff).delete();
  }

  /** Remove every row the device holds: a different User took the Store over. */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.lists.clear(),
      this.items.clear(),
      this.payments.clear(),
      this.memberships.clear(),
      this.memberNames.clear(),
      this.outbox.clear(),
    ]);
  }

  /**
   * Drop a List and everything that belongs to it, queued writes included.
   * Member names stay: they belong to the Member, not the List.
   */
  async removeList(listId: string): Promise<void> {
    const outboxIds = (
      await this.outbox
        .filter(
          (entry) =>
            entry.listId === listId || (entry.targetType === "list" && entry.targetId === listId),
        )
        .toArray()
    ).map((entry) => entry.id!);
    await Promise.all([
      this.lists.delete(listId),
      this.items.where("listId").equals(listId).delete(),
      this.payments.where("listId").equals(listId).delete(),
      this.memberships.where("listId").equals(listId).delete(),
      outboxIds.length > 0 ? this.outbox.bulkDelete(outboxIds) : Promise.resolve(),
    ]);
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

/** Group queued writes by target, oldest group first; update and delete stay apart. */
function groupPendingEntries(entries: OutboxEntry[]): OutboxEntry[][] {
  const groups = new Map<string, OutboxEntry[]>();
  for (const entry of entries) {
    const key = `${entry.targetType}:${entry.targetId}:${entry.operation}`;
    const group = groups.get(key);
    if (group) {
      group.push(entry);
      continue;
    }
    groups.set(key, [entry]);
  }
  return [...groups.values()];
}
