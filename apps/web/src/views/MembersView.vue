<script setup lang="ts">
// Vue
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

// Domain types
import type { ListInvitation } from "@shopping-list/api/domain";

// Cross-file logic
import { useLiveMembers } from "../composables/useLiveMembers";
import { useLivePayments } from "../composables/useLivePayments";
import { leaveList, syncMembershipsFromServer } from "../members";
import { createInvitation, listInvitations, revokeInvitation } from "../invitations";
import { useSyncPass } from "../connectivity";
import { db } from "../db";
import { session } from "../session";
import { computeOwed } from "../utils/computeOwed";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";
import { formatEuro } from "../utils/formatEuro";
import { owedPresentation } from "../utils/owedPresentation";
import { submit } from "../utils/submit";

// Component-local
import ListScreen from "../components/ListScreen.vue";
import InvitationsPanel from "../components/InvitationsPanel.vue";

// Route input
const route = useRoute();
const router = useRouter();
const listId = computed(() => String(route.params.listId ?? ""));

// Live reads
const members = useLiveMembers(listId);
const payments = useLivePayments(listId);

// Local state
const invitations = ref<ListInvitation[]>([]);
const error = ref<string | null>(null);
const loaded = ref(false);
/** The Store has answered once: the rows below are the List's Members, not a gap. */
watch(
  members,
  () => {
    loaded.value = true;
  },
  { once: true },
);
const leavePending = ref(false);
const invitePending = ref(false);
const inviteForm = ref({
  email: "",
});

// Standing
const standing = computed(() =>
  computeOwed(
    members.value.map((member) => member.memberId),
    payments.value,
  ),
);

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

/** The Owner panel and the leave action are opposites: exactly one of them shows. */
const showInvitations = computed(() => loaded.value && isOwner());

// Helpers
/**
 * How this screen words an Owed figure: a Member row names them in the third
 * person and carries the figure inside the wording.
 */
const owedVoice = {
  owes: (figureInCents: number) => `owes ${formatEuro(figureInCents)}`,
  owed: (figureInCents: number) => `is owed ${formatEuro(figureInCents)}`,
  settled: "settled",
};

/** The Owner is the first Member the Store lists, so the first row names them. */
const isOwner = () => members.value[0]?.memberId === session.user?.id;

// Handlers
async function loadInvitations() {
  invitations.value = await listInvitations(listId.value);
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

// Sync wiring and lifecycle
useSyncPass(async () => {
  await ignoreRejection(syncMembershipsFromServer(db, listId.value));
  await ignoreRejection(loadInvitations());
});

onMounted(() => {
  // Invitations only ever come from the server, so they keep a read of their
  // own; the Members and Payments above are read live and repaint themselves.
  // The Membership pull names the Members the Store holds no name for, which
  // is every one of them on a cold start, and replaces the set when someone
  // has joined or left elsewhere.
  void ignoreRejection(syncMembershipsFromServer(db, listId.value));
  logRejection(loadInvitations(), "Loading the invitations");
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
          <div class="member-info">
            <span v-if="row.share" class="member-share">{{ row.share }}</span>
            <span v-if="row.owed" class="member-owed">{{ row.owed }}</span>
          </div>
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
      <button type="button" name="leave-list" :disabled="leavePending" @click="onLeave">
        Leave this list
      </button>
    </p>

    <p v-if="error" class="error">{{ error }}</p>
  </ListScreen>
</template>

<style scoped>
/* Name left, figures right, on the row's baseline so amounts read as a table
   even when a name wraps. */
ul {
  li {
    align-items: baseline;
    padding-block: var(--space-4);
    border-bottom: 1px solid var(--color-rule);

    &:last-child {
      border-bottom: none;
    }

    .member-name {
      margin-inline-end: auto;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .member-share {
      color: var(--color-ink-muted);
      white-space: nowrap;
      font-size: var(--fs-small);
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
}

.member-info {
  display: flex;
  flex-direction: column;
  text-align: end;
}

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

/* The leave action reads as the text style of its siblings in the sheet, and
   says so in the Owes colour rather than the button default. */
.leave-row {
  padding-block: var(--space-3);

  button {
    border-color: transparent;
    background-color: transparent;
    color: var(--color-owes);

    &:hover:not(:disabled) {
      background-color: var(--color-danger-soft);
    }
  }
}
</style>
