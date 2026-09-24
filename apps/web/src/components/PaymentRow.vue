<script setup lang="ts">
import { ref } from "vue";
import type { Payment } from "@shopping-list/api/domain";

/**
 * One Payment in the ledger: its amount and date, or — for a Payment you made
 * — the form that edits them. Saving and deleting are the screen's job, so
 * this row owns only its own edit state, and shows the message when a save is
 * rejected.
 */
const props = defineProps<{
  payment: Payment;
  own: boolean;
  format: (cents: number) => string;
  save: (payment: Payment, amount: string, date: string) => Promise<void>;
  remove: (payment: Payment) => Promise<void>;
}>();

const editing = ref(false);
const form = ref({ amount: "", date: "", error: null as string | null });

function startEdit() {
  form.value = {
    amount: (props.payment.amountInCents / 100).toFixed(2),
    date: props.payment.paidAt.slice(0, 10),
    error: null,
  };
  editing.value = true;
}

async function onSave() {
  form.value.error = null;
  try {
    await props.save(props.payment, form.value.amount, form.value.date);
  } catch (err) {
    form.value.error = err instanceof Error ? err.message : "Could not update the payment";
    return;
  }
  editing.value = false;
}
</script>

<template>
  <form v-if="editing" class="edit-payment-form" @submit.prevent="onSave">
    <input
      v-model="form.amount"
      name="edit-amount"
      aria-label="Amount in euro"
      inputmode="decimal"
    />
    <input v-model="form.date" name="edit-date" aria-label="Date paid" type="date" />
    <div class="edit-actions">
      <button type="submit">Save</button>
      <button type="button" @click="editing = false">Cancel</button>
    </div>
    <p v-if="form.error" class="error">{{ form.error }}</p>
  </form>

  <template v-else>
    <span class="amount">{{ format(payment.amountInCents) }}</span>
    <span class="date">{{ payment.paidAt.slice(0, 10) }}</span>
    <span v-if="own" class="actions">
      <button type="button" name="edit-payment" @click="startEdit">Edit</button>
      <button type="button" class="delete" name="delete-payment" @click="remove(payment)">
        Delete
      </button>
    </span>
  </template>
</template>

<style scoped>
/* The date field needs its intrinsic width, so it gets its own column and the
   amount takes what is left; the buttons sit on the row below. */
.edit-payment-form {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(4.5rem, 1fr) minmax(9rem, max-content);
  gap: var(--space-2);
}

.edit-actions {
  display: flex;
  grid-column: 1 / -1;
  gap: var(--space-2);
}

.edit-payment-form .error {
  grid-column: 1 / -1;
  font-size: var(--fs-small);
}

.amount {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.date {
  color: var(--color-ink-muted);
  font-size: var(--fs-small);
}

.actions {
  display: flex;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.actions button {
  min-height: 2.25rem;
  padding-inline: var(--space-2);
  border: 0;
  background: none;
  color: var(--color-ink-muted);
  font-size: var(--fs-small);
}

.actions button.delete {
  margin-inline-end: calc(var(--space-2) * -1);
}

.actions button:hover:not(:disabled) {
  background: none;
  color: var(--color-ink);
  text-decoration: underline;
}

.actions button.delete:hover:not(:disabled) {
  color: var(--color-owes);
}
</style>
