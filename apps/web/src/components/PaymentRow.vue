<script setup lang="ts">
import { ref } from "vue";
import type { Payment } from "@shopping-list/api/domain";
import pencilIcon from "@/assets/icones-bags-svg/pencil.svg?raw";
import trashIcon from "@/assets/icones-bags-svg/trash.svg?raw";

/**
 * One Payment in the ledger, laid out like a message: a card the width of its
 * own contents, pinned to the side the Payment belongs to — yours on the
 * right, everyone else's on the left — with the figure on its own line so no
 * date can push it inward. Your Edit and Delete ride beside the card, on the
 * inside, so the card itself stays flush with the sheet's edge. Saving and
 * deleting are the screen's job, so this row owns only its own edit state, and
 * shows the message when a save is rejected.
 */
const props = defineProps<{
  payment: Payment;
  who: string;
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
  <li :class="{ own }">
    <form v-if="editing" aria-label="Edit payment" @submit.prevent="onSave">
      <input
        v-model="form.amount"
        name="edit-amount"
        aria-label="Amount in euro"
        inputmode="decimal"
      />
      <input v-model="form.date" name="edit-date" aria-label="Date paid" type="date" />
      <div>
        <button type="submit">Save</button>
        <button type="button" @click="editing = false">Cancel</button>
      </div>
      <p v-if="form.error" class="error">{{ form.error }}</p>
    </form>

    <template v-else>
      <template v-if="own">
        <button
          type="button"
          name="edit-payment"
          aria-label="Edit payment"
          v-html="pencilIcon"
          @click="startEdit"
        />
        <button
          type="button"
          name="delete-payment"
          aria-label="Delete payment"
          v-html="trashIcon"
          @click="remove(payment)"
        />
      </template>
      <div>
        <p>{{ format(payment.amountInCents) }}</p>
        <div>
          <span>{{ who }}</span>
          <time :datetime="payment.paidAt">{{ payment.paidAt.slice(0, 10) }}</time>
        </div>
      </div>
    </template>
  </li>
</template>

<style scoped>
/* Editing takes over the row: the form becomes its own chat bubble, the same
   shape and edge as the card it replaces, with the fields stacked inside it.
   The bubble is small, so its fields sit tighter than the screen's own. */
form {
  display: flex;
  max-width: 70%;
  flex: 0 1 auto;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-lg);
  background-color: var(--color-paper);

  input {
    min-height: 2rem;
    padding-inline: var(--space-1);
  }

  p {
    font-size: var(--fs-small);
  }

  > div {
    display: flex;
    gap: var(--space-2);
  }

  button {
    flex: 1;
    min-height: 1rem;
  }
}

/**
 * The row is one message in the ledger: the card takes the place of the sheet's
 * hairline, and the row hands the money back the gutters the sheet spends.
 */
li {
  gap: var(--space-2);
  padding-block: var(--space-1);
  padding-inline: var(--space-3);
  border-bottom: none;

  /* The card is the size of its own contents, capped at 70% of the row so the
     payer and the date can never stretch it across the sheet. */
  > div {
    display: flex;
    max-width: 70%;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    background-color: var(--color-paper);
  }

  /* The figure on its own line, so no date can push it inward. */
  > div > p {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  /* The payer and the date ride under the figure. */
  > div > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    align-items: baseline;
    color: var(--color-ink-muted);
    font-size: var(--fs-small);
  }

  > div > div span {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  /* The row's own actions ride beside the card, on the inside, so the card
     itself stays flush with the sheet's edge. */
  > button {
    width: 2rem;
    min-height: 2.5rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-ink-muted);
    font-size: 1.625rem;

    &:hover:not(:disabled) {
      background: none;
      color: var(--color-ink);
    }
  }

  > button[name="delete-payment"]:hover:not(:disabled) {
    color: var(--color-owes);
  }

  /* Yours hangs off the right-hand edge, everyone else's off the left, and the
     card packs its own lines against that same edge. */
  &.own {
    justify-content: flex-end;

    > div {
      align-items: flex-end;
    }

    > div > div {
      justify-content: flex-end;
    }
  }
}

time {
  font-variant-numeric: tabular-nums;
}
</style>
