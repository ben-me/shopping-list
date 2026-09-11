<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Item, Payment } from "@shopping-list/api/domain";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { addItem, removeItem, setItemChecked, syncItemsFromServer } from "../items";
import { addPayment, removePayment, syncPaymentsFromServer, updatePayment } from "../payments";
import { syncOutbox } from "../lists";
import { session } from "../session";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const listName = ref<string | null>(null);
const items = ref<Item[]>([]);
const payments = ref<Payment[]>([]);
const itemForm = ref({
  name: "",
  error: null as string | null,
});
const paymentForm = ref({
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  error: null as string | null,
});
const editingPaymentId = ref<string | null>(null);
const editForm = ref({
  amount: "",
  date: "",
  error: null as string | null,
});

const euroFormat = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const formatEuro = (cents: number) => euroFormat.format(cents / 100);
const isoFromDate = (date: string) => new Date(`${date}T12:00:00.000Z`).toISOString();
const isOwn = (payment: Payment) => payment.memberId === session.user?.id;

async function loadList() {
  const list = await db.getList(listId.value);
  listName.value = list?.name ?? null;
}

async function loadItems() {
  items.value = await db.getItems(listId.value);
}

async function loadPayments() {
  payments.value = (await db.getPayments(listId.value)).slice().reverse();
}

async function onAdd() {
  itemForm.value.error = null;
  try {
    await addItem(db, listId.value, itemForm.value.name);
  } catch (err) {
    itemForm.value.error = err instanceof Error ? err.message : "Could not add the item";
    return;
  }
  itemForm.value.name = "";
  await logRejection(loadItems(), "Loading the items");
  ignoreRejection(syncOutbox(db));
}

async function onToggle(item: Item, checked: boolean) {
  await logRejection(setItemChecked(db, item, checked), "Ticking the item");
  await logRejection(loadItems(), "Loading the items");
  ignoreRejection(syncOutbox(db));
}

async function onRemove(item: Item) {
  await logRejection(removeItem(db, item), "Removing the item");
  await logRejection(loadItems(), "Loading the items");
  ignoreRejection(syncOutbox(db));
}

async function onRecordPayment() {
  paymentForm.value.error = null;
  if (!session.user) {
    paymentForm.value.error = "Sign in to record a payment";
    return;
  }
  try {
    await addPayment(
      db,
      listId.value,
      session.user.id,
      paymentForm.value.amount,
      isoFromDate(paymentForm.value.date),
    );
  } catch (err) {
    paymentForm.value.error = err instanceof Error ? err.message : "Could not record the payment";
    return;
  }
  paymentForm.value.amount = "";
  paymentForm.value.date = new Date().toISOString().slice(0, 10);
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

function startEdit(payment: Payment) {
  editingPaymentId.value = payment.id;
  editForm.value = {
    amount: (payment.amountInCents / 100).toFixed(2),
    date: payment.paidAt.slice(0, 10),
    error: null,
  };
}

function cancelEdit() {
  editingPaymentId.value = null;
}

async function onSaveEdit(payment: Payment) {
  editForm.value.error = null;
  try {
    await updatePayment(db, payment, {
      amountInEur: editForm.value.amount,
      paidAt: isoFromDate(editForm.value.date),
    });
  } catch (err) {
    editForm.value.error = err instanceof Error ? err.message : "Could not update the payment";
    return;
  }
  editingPaymentId.value = null;
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

async function onDeletePayment(payment: Payment) {
  await logRejection(removePayment(db, payment), "Removing the payment");
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

let stopSyncPass: (() => void) | null = null;

onMounted(() => {
  logRejection(loadList(), "Loading the list");
  logRejection(loadItems(), "Loading the items");
  logRejection(loadPayments(), "Loading the payments");
  stopSyncPass = onSyncPass(async (db) => {
    await ignoreRejection(syncItemsFromServer(db, listId.value));
    await ignoreRejection(syncPaymentsFromServer(db, listId.value));
    await logRejection(loadItems(), "Loading the items");
    await logRejection(loadPayments(), "Loading the payments");
  });
  void ignoreRejection(runSyncPass(db));
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <h1>{{ listName ?? "List" }}</h1>
  <p v-if="items.length === 0">Nothing on this list yet.</p>
  <ul>
    <li v-for="item in items" :key="item.id">
      <label>
        <input
          type="checkbox"
          name="checked"
          :checked="item.checked"
          @change="onToggle(item, ($event.target as HTMLInputElement).checked)"
        />
        <span :class="{ bought: item.checked }">{{ item.name }}</span>
      </label>
      <button type="button" @click="onRemove(item)">Remove</button>
    </li>
  </ul>
  <form @submit.prevent="onAdd">
    <label>
      Item name
      <input v-model="itemForm.name" name="item" />
    </label>
    <button type="submit">Add an Item</button>
  </form>
  <p v-if="itemForm.error">{{ itemForm.error }}</p>

  <section class="payments">
    <h2>Payments</h2>
    <p v-if="payments.length === 0">No payments recorded yet.</p>
    <ul>
      <li v-for="payment in payments" :key="payment.id">
        <template v-if="editingPaymentId === payment.id">
          <form class="edit-payment-form" @submit.prevent="onSaveEdit(payment)">
            <label>
              Amount €
              <input v-model="editForm.amount" name="edit-amount" type="text" inputmode="decimal" />
            </label>
            <label>
              Date
              <input v-model="editForm.date" name="edit-date" type="date" />
            </label>
            <button type="submit">Save</button>
            <button type="button" @click="cancelEdit">Cancel</button>
            <p v-if="editForm.error">{{ editForm.error }}</p>
          </form>
        </template>
        <template v-else>
          {{ formatEuro(payment.amountInCents) }}
          {{ payment.paidAt.slice(0, 10) }}
          <button
            v-if="isOwn(payment)"
            type="button"
            name="edit-payment"
            @click="startEdit(payment)"
          >
            Edit
          </button>
          <button
            v-if="isOwn(payment)"
            type="button"
            name="delete-payment"
            @click="onDeletePayment(payment)"
          >
            Delete
          </button>
        </template>
      </li>
    </ul>
    <form class="payments-form" @submit.prevent="onRecordPayment">
      <label>
        Amount €
        <input v-model="paymentForm.amount" name="payment-amount" type="text" inputmode="decimal" />
      </label>
      <label>
        Date
        <input v-model="paymentForm.date" name="payment-date" type="date" />
      </label>
      <button type="submit">Record a Payment</button>
    </form>
    <p v-if="paymentForm.error">{{ paymentForm.error }}</p>
  </section>
</template>
