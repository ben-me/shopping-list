<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { List, Payment } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import PaymentRow from "../components/PaymentRow.vue";
import { onSyncPass, runSyncPass } from "../connectivity";
import { db } from "../db";
import { syncOutbox } from "../lists";
import { memberIdsOf, syncMembershipsFromServer } from "../members";
import { addPayment, removePayment, syncPaymentsFromServer, updatePayment } from "../payments";
import { session } from "../session";
import { computeOwed } from "../utils/computeOwed";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const list = ref<List | null>(null);
const members = ref<string[]>([]);
const payments = ref<Payment[]>([]);
const paymentForm = ref({
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  error: null as string | null,
});

const euroFormat = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const formatEuro = (cents: number) => euroFormat.format(cents / 100);
const isoFromDate = (date: string) => new Date(`${date}T12:00:00.000Z`).toISOString();
const isOwn = (payment: Payment) => payment.memberId === session.user?.id;

/**
 * The money standing, recomputed live from the loaded Members and Payments —
 * the display surface for the pure Split/Owed calculation.
 */
const standing = computed(() => computeOwed(members.value, payments.value));

const memberLabel = (memberId: string) => (memberId === session.user?.id ? "You" : memberId);

/** The Owed wording and colour for one Member: red owes the group, green the group owes. */
const owedPresentation = (amountInCents: number) =>
  amountInCents > 0
    ? { label: `owes ${formatEuro(amountInCents)}`, className: "owes" }
    : amountInCents < 0
      ? { label: `is owed ${formatEuro(-amountInCents)}`, className: "owed" }
      : { label: "settled", className: "settled" };

/**
 * One row per Member for the standing, each with the equal share. Empty when
 * the List has fewer than two Members — no Split is possible, and a lone
 * Member sees only the running total (spec: no Owed figure).
 */
const standingRows = computed(() => {
  const { shareInCents, owed } = standing.value;
  if (shareInCents === null) {
    return [];
  }
  return owed.map((figure) => ({
    memberId: figure.memberId,
    name: memberLabel(figure.memberId),
    share: `share ${formatEuro(shareInCents)}`,
    ...owedPresentation(figure.amountInCents),
  }));
});

async function loadList() {
  list.value = (await db.getList(listId.value)) ?? null;
  members.value = list.value ? await memberIdsOf(db, list.value) : [];
}

async function loadPayments() {
  payments.value = (await db.getPayments(listId.value)).slice().reverse();
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
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

/** Rejects on an invalid amount or date; the row shows the message. */
async function onSaveEdit(payment: Payment, amount: string, date: string) {
  await updatePayment(db, payment, { amountInEur: amount, paidAt: isoFromDate(date) });
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
  logRejection(loadPayments(), "Loading the payments");
  stopSyncPass = onSyncPass(async (db) => {
    await ignoreRejection(syncPaymentsFromServer(db, listId.value));
    // Members change only through the online invite flow; pull the server
    // truth so an accepted Invitation redivides the standing on every device.
    await ignoreRejection(syncMembershipsFromServer(db, listId.value));
    await logRejection(loadList(), "Loading the list");
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
  <ListScreen :title="list?.name ?? 'List'" :list-id="listId">
    <template #entry>
      <form class="payments-form" @submit.prevent="onRecordPayment">
        <input
          v-model="paymentForm.amount"
          name="payment-amount"
          aria-label="Amount in euro"
          placeholder="0,00"
          inputmode="decimal"
          autocomplete="off"
        />
        <input v-model="paymentForm.date" name="payment-date" aria-label="Date paid" type="date" />
        <button type="submit">Record</button>
      </form>
      <p v-if="paymentForm.error" class="error">{{ paymentForm.error }}</p>
    </template>

    <section class="standing" aria-label="Money standing">
      <p class="total">
        <span class="total-label">Total paid</span>
        <span class="total-paid">{{ formatEuro(standing.totalInCents) }}</span>
      </p>
      <p v-if="standingRows.length === 0" class="empty">
        Only you so far. Invite your household from Members.
      </p>
      <ul v-else class="rows standing-members">
        <li
          v-for="row in standingRows"
          :key="row.memberId"
          class="standing-member"
          :class="row.className"
        >
          <span class="member-name">{{ row.name }}</span>
          <span class="member-share">{{ row.share }}</span>
          <span class="member-owed">{{ row.label }}</span>
        </li>
      </ul>
    </section>

    <ul class="rows payment-list payments">
      <li v-for="payment in payments" :key="payment.id">
        <PaymentRow
          :payment="payment"
          :own="isOwn(payment)"
          :format="formatEuro"
          :save="onSaveEdit"
          :remove="onDeletePayment"
        />
      </li>
    </ul>
    <p v-if="payments.length === 0" class="empty">No payments recorded yet.</p>
  </ListScreen>
</template>

<style scoped>
/* Amount first, then the date: the date field needs its intrinsic width, the
   amount takes whatever is left. */
.entry input[name="payment-amount"] {
  flex: 1 1 3rem;
}

.entry input[name="payment-date"] {
  flex: 1 1 8.75rem;
}

.total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.total-label {
  color: var(--color-ink-muted);
  font-size: var(--fs-small);
  font-weight: 600;
}

/* The one big figure on the screen: wide, heavy, lining up in columns. */
.total-paid {
  font-size: var(--fs-h2);
  font-weight: 700;
  font-stretch: 115%;
  font-variant-numeric: tabular-nums;
}

.standing-members > li {
  justify-content: space-between;
}

.member-name {
  font-weight: 600;
}

.member-share {
  color: var(--color-ink-muted);
  font-size: var(--fs-small);
}

.member-owed {
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

/* Red: this Member owes the group. Green: the group owes them. */
.standing-member.owes .member-owed {
  color: var(--color-owes);
}

.standing-member.owed .member-owed {
  color: var(--color-owed);
}

.standing-member.settled .member-owed {
  color: var(--color-ink-muted);
}

.payment-list > li {
  flex-wrap: wrap;
  padding-block: var(--space-3);
}
</style>
