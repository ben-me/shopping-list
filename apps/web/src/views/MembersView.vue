<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ListInvitation, MemberDetails, Payment } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import InvitationsPanel from "../components/InvitationsPanel.vue";
import { useSyncPass } from "../connectivity";
import { db } from "../db";
import { createInvitation, listInvitations, revokeInvitation } from "../invitations";
import { leaveList, listMembers } from "../members";
import { session } from "../session";
import { computeOwed } from "../utils/computeOwed";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { formatEuro } from "../utils/formatEuro";
import { owedPresentation } from "../utils/owedPresentation";
import { submit } from "../utils/submit";

const route = useRoute();
const router = useRouter();
const listId = computed(() => String(route.params.listId ?? ""));
const members = ref<MemberDetails[]>([]);
const invitations = ref<ListInvitation[]>([]);
const payments = ref<Payment[]>([]);
const error = ref<string | null>(null);
const loaded = ref(false);

const standing = computed(() =>
  computeOwed(
    members.value.map((member) => member.memberId),
    payments.value,
  ),
);

/**
 * How this screen words an Owed figure: a Member row names them in the third
 * person and carries the figure inside the wording.
 */
const owedVoice = {
  owes: (figureInCents: number) => `owes ${formatEuro(figureInCents)}`,
  owed: (figureInCents: number) => `is owed ${formatEuro(figureInCents)}`,
  settled: "settled",
};

/* The access list doubles as the standing table: each Member carries their Share
   and Owed figure. A lone Member has neither; the screen shows the total. */
const memberRows = computed(() => {
  const { shareInCents, owed } = standing.value;
  const figures = new Map(owed.map((figure) => [figure.memberId, figure.amountInCents]));
  return members.value.map((member) => {
    const name = member.memberId === session.user?.id ? `${member.name} (you)` : member.name;
    const amount = figures.get(member.memberId);
    if (shareInCents === null || amount === undefined) {
      return { memberId: member.memberId, name, share: null, owed: null, className: "" };
    }
    const presentation = owedPresentation(amount, owedVoice);
    return {
      memberId: member.memberId,
      name,
      share: `share ${formatEuro(shareInCents)}`,
      owed: presentation.label,
      className: presentation.className,
    };
  });
});

/** A lone Member sees the total of Payments, never an Owed figure. */
const totalPaid = computed(() =>
  standing.value.shareInCents === null ? formatEuro(standing.value.totalInCents) : null,
);

const leavePending = ref(false);
const invitePending = ref(false);
const inviteForm = ref({
  email: "",
});

/** The server always lists the Owner first, so the first row names them. */
const isOwner = () => members.value[0]?.memberId === session.user?.id;

/** The Owner panel and the leave action are opposites: exactly one of them shows. */
const showInvitations = computed(() => loaded.value && isOwner());

async function loadMembers() {
  members.value = await listMembers(listId.value);
}

async function loadInvitations() {
  invitations.value = await listInvitations(listId.value);
}

async function loadPayments() {
  payments.value = await db.getPayments(listId.value);
}

async function loadPanel() {
  await logRejection(loadMembers(), "Loading the members");
  await logRejection(loadInvitations(), "Loading the invitations");
  await logRejection(loadPayments(), "Loading the payments");
  loaded.value = true;
}

async function onInvite() {
  const invited = await submit(
    { error, busy: invitePending },
    "Could not send the invitation",
    async () => {
      await createInvitation(listId.value, inviteForm.value.email);
      await logRejection(loadInvitations(), "Loading the invitations");
    },
  );
  if (!invited) {
    return;
  }
  inviteForm.value.email = "";
}

async function onRevoke(invitation: ListInvitation) {
  await logRejection(revokeInvitation(listId.value, invitation.id), "Revoking the invitation");
  await logRejection(loadInvitations(), "Loading the invitations");
}

/* Online-only, like the invite flow: the server drops the Membership first. */
async function onLeave() {
  const left = await submit({ error, busy: leavePending }, "Could not leave the list", () =>
    leaveList(db, listId.value),
  );
  if (!left) {
    return;
  }
  // The List screen itself is gone now; end on the Lists home.
  await router.push({ name: "lists" });
}

useSyncPass(async () => {
  await ignoreRejection(loadMembers());
  await ignoreRejection(loadInvitations());
  await ignoreRejection(loadPayments());
});

onMounted(() => {
  // No Sync pass of its own: loadPanel reads what this screen renders, and a
  // pass would re-pull it plus the app-wide Lists and inbox it does not show.
  logRejection(loadPanel(), "Loading the members");
});
</script>

<template>
  <ListScreen>
    <p v-if="!loaded" class="empty">Loading…</p>
    <template v-else>
      <!-- The access list doubles as the standing table: each Member's name,
           Share and Owed figure, ruled off like the other screens' rows. -->
      <ul class="rows">
        <li v-for="row in memberRows" :key="row.memberId" :class="row.className">
          <span class="member-name">{{ row.name }}</span>
          <span v-if="row.share" class="member-share">{{ row.share }}</span>
          <span v-if="row.owed" class="member-owed">{{ row.owed }}</span>
        </li>
      </ul>
      <!-- A lone Member has no Owed figure; the running total stands in. -->
      <p v-if="totalPaid" class="member-total">
        <span class="member-total-label">Total paid</span>
        <span class="member-total-paid">{{ totalPaid }}</span>
      </p>
    </template>

    <InvitationsPanel
      v-if="showInvitations"
      v-model:email="inviteForm.email"
      :invitations="invitations"
      :submitting="invitePending"
      @invite="onInvite"
      @revoke="onRevoke"
    />
    <p v-else-if="loaded" class="leave-row">
      <button
        type="button"
        class="danger"
        name="leave-list"
        :disabled="leavePending"
        @click="onLeave"
      >
        Leave this list
      </button>
    </p>

    <p v-if="error" class="error">{{ error }}</p>
  </ListScreen>
</template>

<style scoped>
/* Name left, figures right. They share the row's baseline so amounts read as a
   table even when a name wraps. */
li {
  align-items: baseline;

  .member-name {
    margin-inline-end: auto;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .member-share {
    color: var(--color-ink-muted);
    white-space: nowrap;
  }

  .member-owed {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    white-space: nowrap;
  }

  /* Red: this Member owes the group. Green: the group owes them. */
  &.owes .member-owed {
    color: var(--color-owes);
  }

  &.owed .member-owed {
    color: var(--color-owed);
  }

  &.settled .member-owed {
    color: var(--color-ink-muted);
  }
}

/* The lone-Member figure: label on the left, the money on the right. */
.member-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);

  .member-total-label {
    color: var(--color-ink-muted);
  }

  .member-total-paid {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
}

/* The leave action reads as the text style of its siblings in the sheet. */
.leave-row {
  padding-block: var(--space-3);
}
</style>
