<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Payment } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import PaymentRow from "../components/PaymentRow.vue";
import { runSyncPass, useSyncPass } from "../connectivity";
import { db } from "../db";
import { syncOutbox } from "../lists";
import { memberIdsOf, syncMembershipsFromServer } from "../members";
import { addPayment, removePayment, syncPaymentsFromServer, updatePayment } from "../payments";
import { session } from "../session";
import type { ShoppingDb } from "../store";
import { computeOwed } from "../utils/computeOwed";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { formatEuro } from "../utils/formatEuro";
import { owedPresentation } from "../utils/owedPresentation";
import { submit } from "../utils/submit";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const members = ref<string[]>([]);
const payments = ref<Payment[]>([]);
const memberNames = ref<Record<string, string>>({});
const paymentForm = ref({
  amount: "",
  date: new Date().toISOString().slice(0, 10),
});
const paymentError = ref<string | null>(null);

const isoFromDate = (date: string) => new Date(`${date}T12:00:00.000Z`).toISOString();
const isOwn = (payment: Payment) => payment.memberId === session.user?.id;
const standing = computed(() => computeOwed(members.value, payments.value));

const memberLabel = (memberId: string) => {
  if (memberId === session.user?.id) {
    return "You";
  }
  return memberNames.value[memberId] ?? "Member";
};

/**
 * How this screen words your own net: it speaks to you and shows the figure
 * beside the wording instead of inside it.
 */
const myOwedVoice = { owes: () => "You owe", owed: () => "You are owed", settled: "Settled up" };

/** The Owed wording for your own net: what you hand over, or what you're owed. */
const myStanding = computed(() => {
  const id = session.user?.id;
  const figure = id ? standing.value.owed.find((owed) => owed.memberId === id) : undefined;
  return figure ? owedPresentation(figure.amountInCents, myOwedVoice) : null;
});

/** The Owner always counts as a Member, so the split needs the List row. */
async function loadMembers() {
  const list = await db.getList(listId.value);
  members.value = list ? await memberIdsOf(db, list) : [];
}

async function loadPayments() {
  payments.value = (await db.getPayments(listId.value)).slice().reverse();
}

async function syncMembers(store: ShoppingDb) {
  const details = await syncMembershipsFromServer(store, listId.value);
  memberNames.value = Object.fromEntries(details.map((member) => [member.memberId, member.name]));
}

async function onRecordPayment() {
  const user = session.user;
  if (!user) {
    paymentError.value = "Sign in to record a payment";
    return;
  }
  const recorded = await submit({ error: paymentError }, "Could not record the payment", () =>
    addPayment(
      db,
      listId.value,
      user.id,
      paymentForm.value.amount,
      isoFromDate(paymentForm.value.date),
    ),
  );
  if (!recorded) {
    return;
  }
  paymentForm.value.amount = "";
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

/** Rejects on an invalid amount or date; the row shows the message. */
async function onSaveEdit(payment: Payment, amount: string, date: string) {
  await updatePayment(db, payment.id, payment.listId, {
    amountInEur: amount,
    paidAt: isoFromDate(date),
  });
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

async function onDeletePayment(payment: Payment) {
  await logRejection(removePayment(db, payment), "Removing the payment");
  await logRejection(loadPayments(), "Loading the payments");
  ignoreRejection(syncOutbox(db));
}

useSyncPass(async (db) => {
  await ignoreRejection(syncPaymentsFromServer(db, listId.value));
  // An accepted Invitation redivides the standing, so re-pull the Members.
  await ignoreRejection(syncMembers(db));
  await logRejection(loadMembers(), "Loading the members");
  await logRejection(loadPayments(), "Loading the payments");
});

onMounted(() => {
  logRejection(loadMembers(), "Loading the members");
  logRejection(loadPayments(), "Loading the payments");
  // A list-scoped pass: this screen drains the outbox and pulls its own
  // Payments and Memberships, but not the app-wide Lists index or inbox.
  void ignoreRejection(runSyncPass(db, "list"));
});
</script>

<template>
  <ListScreen>
    <template #entry>
      <form @submit.prevent="onRecordPayment">
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
      <p v-if="paymentError" class="error">{{ paymentError }}</p>
    </template>

    <ul>
      <PaymentRow
        v-for="payment in payments"
        :key="payment.id"
        :payment="payment"
        :who="memberLabel(payment.memberId)"
        :own="isOwn(payment)"
        :save="onSaveEdit"
        :remove="onDeletePayment"
      />
    </ul>
    <p v-if="payments.length === 0" class="empty">No payments recorded yet.</p>

    <template #footer>
      <p class="total">
        <span class="total-label">Total paid</span>
        <span class="total-paid">{{ formatEuro(standing.totalInCents) }}</span>
      </p>
      <p v-if="myStanding" class="own-standing" :class="myStanding.className">
        <span class="own-standing-label">{{ myStanding.label }}</span>
        <span v-if="myStanding.figure" class="own-standing-figure">{{ myStanding.figure }}</span>
      </p>
    </template>
  </ListScreen>
</template>

<style scoped>
/* Amount first, then the date: the date field needs its intrinsic width and
   the amount takes whatever is left. Three controls on one line is tight on a
   phone, so the bar closes the gaps and the button spends no width on padding. */
form {
  gap: var(--space-1);

  input[name="payment-amount"] {
    flex: 1 1 3rem;
  }

  input[name="payment-date"] {
    flex: 1 1 8.75rem;
  }

  button {
    flex: none;
    padding-inline: var(--space-2);
  }
}

/* Label on the left, the figure on the right; on a very narrow screen a long
   figure wraps under its label rather than pushing it off the bar. */
.total,
.own-standing {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

/* Both labels ride in the ink bar beside their figure, so they are set in
   paper; the size difference keeps the running total the louder of the two. */
.total-label,
.own-standing-label {
  color: var(--color-paper);
  font-weight: 600;
}

.total-label {
  font-size: var(--fs-h2);
}

.own-standing-label {
  font-size: var(--fs-small);
}

.total-paid {
  color: var(--color-paper);
  font-size: var(--fs-h2);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.own-standing-figure {
  font-size: var(--fs-small);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Green: the group owes you. Red: you owe the group. */
.own-standing.owed .own-standing-figure {
  color: var(--color-owed-on-ink);
}

.own-standing.owes .own-standing-figure {
  color: var(--color-owes-on-ink);
}
</style>
