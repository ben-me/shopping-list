<script setup lang="ts">
import { computed, ref } from "vue";
import type { Payment } from "@shopping-list/api/domain";
import pencilIcon from "@/assets/svg/pencil.svg?raw";
import trashIcon from "@/assets/svg/trash.svg?raw";
import { formatEuro } from "../utils/formatEuro";
import { submit } from "../utils/submit";

/* One Payment as a message: a card on the payer's side, the figure on its own
   line. This row owns its edit state; saving is the screen's job. */
const props = defineProps<{
  payment: Payment;
  who: string;
  own: boolean;
  save: (payment: Payment, amount: string, date: string) => Promise<void>;
  remove: (payment: Payment) => Promise<void>;
}>();

const editing = ref(false);
const form = ref({ amount: "", date: "" });
const formError = ref<string | null>(null);

const paidOn = computed(() => {
  const [year = 0, month = 1, day = 1] = props.payment.paidAt.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
});

function startEdit() {
  form.value = {
    amount: (props.payment.amountInCents / 100).toFixed(2),
    date: props.payment.paidAt.slice(0, 10),
  };
  formError.value = null;
  editing.value = true;
}

async function onSave() {
  const saved = await submit({ error: formError }, "Could not update the payment", () =>
    props.save(props.payment, form.value.amount, form.value.date),
  );
  if (!saved) {
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
      <p v-if="formError" class="error">{{ formError }}</p>
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
        <p>{{ formatEuro(payment.amountInCents) }}</p>
        <div>
          <span>{{ who }}</span>
          <time :datetime="payment.paidAt">{{ paidOn }}</time>
        </div>
      </div>
    </template>
  </li>
</template>

<style scoped>
/* One shape for the card and for the edit form, capped at 70% so a long date
   cannot stretch it across the sheet. */
form,
li > div {
  max-width: 70%;
  padding: var(--space-2) var(--space-3);
  border: var(--hairline) solid var(--color-rule);
  border-radius: var(--radius-lg);
}

form {
  display: flex;
  flex-direction: column;

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
  }
}

/* The card stands in for the sheet's hairline: this is a message on a thread,
   not a ruled ledger line, so the row owns nothing but its own gutters. */
li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);

  > div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);

    p {
      font-weight: 600;
    }

    div {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      align-items: baseline;
      color: var(--color-ink-muted);
      font-size: var(--fs-small);
    }
  }

  > div > div span {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  > button {
    padding: 0.25rem;
    background: none;
    color: var(--color-ink-muted);
    font-size: 1.75rem;
  }

  > button:hover:not(:disabled) {
    color: var(--color-ink);
  }

  > button[name="delete-payment"]:hover:not(:disabled) {
    color: var(--color-owes);
  }

  &.own {
    justify-content: flex-end;

    div {
      align-items: flex-end;
    }
  }
}

time {
  font-variant-numeric: tabular-nums;
}
</style>
