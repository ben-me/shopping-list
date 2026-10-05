<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Payment } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import PaymentRow from "../components/PaymentRow.vue";
import { runSyncPass, useSyncPass } from "../connectivity";
import { useLiveMemberNames } from "../composables/useLiveMemberNames";
import { useLiveMembers } from "../composables/useLiveMembers";
import { useLivePayments } from "../composables/useLivePayments";
import { db } from "../db";
import { syncOutbox } from "../lists";
import { syncMembershipsFromServer, UNKNOWN_MEMBER_NAME } from "../members";
import { addPayment, removePayment, syncPaymentsFromServer, updatePayment } from "../payments";
import { session } from "../session";
import { computeOwed } from "../utils/computeOwed";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { formatEuro } from "../utils/formatEuro";
import { owedPresentation } from "../utils/owedPresentation";
import { submit } from "../utils/submit";

const route = useRoute();
const listId = computed(() => String(route.params.listId ?? ""));
const members = useLiveMembers(listId);
const payments = useLivePayments(listId);
/** The Split divides across the Members the List has now; a row is labelled by
 *  name, and a name outlives the Membership that carried it. */
const memberIds = computed(() => members.value.map((member) => member.memberId));
const memberNames = useLiveMemberNames();
const paymentForm = ref({
  amount: "",
  date: new Date().toISOString().slice(0, 10),
});
const paymentError = ref<string | null>(null);

/** The day as an instant, noon so a timezone either side of UTC cannot move it.
 *  A day that is not there stays a day that is not there: the form says so. */
const isoFromDate = (date: string) =>
  date === "" ? "" : new Date(`${date}T12:00:00.000Z`).toISOString();
const isOwn = (payment: Payment) => payment.memberId === session.user?.id;
const standing = computed(() => computeOwed(memberIds.value, payments.value));

const memberLabel = (memberId: string) => {
  if (memberId === session.user?.id) {
    return "You";
  }
  return memberNames.value[memberId] ?? UNKNOWN_MEMBER_NAME;
};

const userPaymentStatus = {
  owes: () => "You owe",
  owed: () => "You are owed",
  settled: "Settled up",
};

/** The Owed wording for your own net: what you hand over, or what you're owed. */
const myStanding = computed(() => {
  const id = session.user?.id;
  const figure = id ? standing.value.owed.find((owed) => owed.memberId === id) : undefined;
  return figure ? owedPresentation(figure.amountInCents, userPaymentStatus) : null;
});

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
  ignoreRejection(syncOutbox(db));
}

/** Rejects on an invalid amount or date; the row shows the message. */
async function onSaveEdit(payment: Payment, amount: string, date: string) {
  await updatePayment(db, payment.id, payment.listId, {
    amountInEur: amount,
    paidAt: isoFromDate(date),
  });
  ignoreRejection(syncOutbox(db));
}

async function onDeletePayment(payment: Payment) {
  await logRejection(removePayment(db, payment), "Removing the payment");
  ignoreRejection(syncOutbox(db));
}

useSyncPass(async (db) => {
  await ignoreRejection(syncPaymentsFromServer(db, listId.value));
  // A new Member redivides the standing, and brings their name with it.
  await ignoreRejection(syncMembershipsFromServer(db, listId.value));
});

onMounted(() => {
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
form {
  display: flex;

  input {
    min-width: 0;

    &:not([type="date"]) {
      flex-grow: 1;
    }

    &[type="date"] {
      min-width: fit-content;
    }
  }

  button {
    flex: 0;
    padding-inline: var(--space-2);
  }
}

.total,
.own-standing {
  display: flex;
  justify-content: space-between;
}

.total-label,
.own-standing-label {
  font-weight: 600;
}

.total-label {
  font-size: var(--fs-h2);
}

.own-standing-label {
  font-size: var(--fs-small);
}

.total-paid {
  font-size: var(--fs-h2);
  font-weight: 700;
}

.own-standing-figure {
  font-size: var(--fs-small);
  font-weight: 700;
}

/* Green: the group owes you. Red: you owe the group. */
.own-standing.owed .own-standing-figure {
  color: var(--color-owed-on-ink);
}

.own-standing.owes .own-standing-figure {
  color: var(--color-owes-on-ink);
}
</style>
