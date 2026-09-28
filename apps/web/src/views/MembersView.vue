<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ListInvitation, MemberDetails, Payment } from "@shopping-list/api/domain";
import ListScreen from "../components/ListScreen.vue";
import { onSyncPass } from "../connectivity";
import { db } from "../db";
import { createInvitation, listInvitations, revokeInvitation } from "../invitations";
import { leaveList, listMembers } from "../members";
import { session } from "../session";
import { computeOwed } from "../utils/computeOwed";
import { ignoreRejection, logRejection } from "../utils/fireAndForget";

const route = useRoute();
const router = useRouter();
const listId = computed(() => String(route.params.listId ?? ""));
const members = ref<MemberDetails[]>([]);
const invitations = ref<ListInvitation[]>([]);
const payments = ref<Payment[]>([]);
const error = ref<string | null>(null);
const loaded = ref(false);

const euroFormat = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const formatEuro = (cents: number) => euroFormat.format(cents / 100);

const standing = computed(() =>
  computeOwed(
    members.value.map((member) => member.memberId),
    payments.value,
  ),
);

/** The Owed wording and colour for one Member: red owes the group, green the group owes. */
const owedPresentation = (amountInCents: number) =>
  amountInCents > 0
    ? { label: `owes ${formatEuro(amountInCents)}`, className: "owes" }
    : amountInCents < 0
      ? { label: `is owed ${formatEuro(-amountInCents)}`, className: "owed" }
      : { label: "settled", className: "settled" };

/**
 * The access list doubles as the standing table: each Member carries their
 * Share and their Owed figure beside their name. A lone Member has no Share
 * and no Owed figure — the screen shows the running total instead.
 */
const memberRows = computed(() => {
  const { shareInCents, owed } = standing.value;
  const figures = new Map(owed.map((figure) => [figure.memberId, figure.amountInCents]));
  return members.value.map((member) => {
    const name = member.memberId === session.user?.id ? `${member.name} (you)` : member.name;
    const amount = figures.get(member.memberId);
    if (shareInCents === null || amount === undefined) {
      return { memberId: member.memberId, name, share: null, owed: null, className: "" };
    }
    const presentation = owedPresentation(amount);
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

/** Invitations that can still be revoked; accepted ones are hidden from the Owner panel. */
const openInvitations = computed(() =>
  invitations.value.filter((invite) => invite.status !== "accepted"),
);

const leavePending = ref(false);
const inviteForm = ref({
  email: "",
  submitting: false,
});

/** The server always lists the Owner first, so the first row names them. */
const isOwner = () => members.value[0]?.memberId === session.user?.id;

const statusLabel = (status: ListInvitation["status"]) =>
  status === "pending" ? "invited" : status === "accepted" ? "joined" : "closed";

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
  error.value = null;
  inviteForm.value.submitting = true;
  try {
    await createInvitation(listId.value, inviteForm.value.email);
    await logRejection(loadInvitations(), "Loading the invitations");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not send the invitation";
    return;
  } finally {
    inviteForm.value.submitting = false;
  }
  inviteForm.value.email = "";
}

async function onRevoke(invitation: ListInvitation) {
  await logRejection(revokeInvitation(listId.value, invitation.id), "Revoking the invitation");
  await logRejection(loadInvitations(), "Loading the invitations");
}

/**
 * A Member departs (ADR 0003), online-only like the invite flow. The server
 * drops the Membership first, then the local List goes; the Lists home re-reads
 * the Store on navigation, so the left List is gone from there too.
 */
async function onLeave() {
  error.value = null;
  leavePending.value = true;
  try {
    await leaveList(db, listId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not leave the list";
    return;
  } finally {
    leavePending.value = false;
  }
  // The List screen itself is gone now; end on the Lists home.
  await router.push({ name: "lists" });
}

let stopSyncPass: (() => void) | null = null;

onMounted(() => {
  // Mount reads the server state this screen needs directly (members and
  // invitations) and Payments locally, so it deliberately starts no Sync
  // pass of its own — a pass would re-pull the same members and invitations
  // after `loadPanel` and drag in the app-wide Lists and inbox pulls, which
  // this screen does not render. It stays subscribed to passes started
  // elsewhere (a reconnect, an accepted Invitation) so the access list and
  // standing are never stale while the screen is open.
  logRejection(loadPanel(), "Loading the members");
  stopSyncPass = onSyncPass(async () => {
    await ignoreRejection(loadMembers());
    await ignoreRejection(loadInvitations());
    await ignoreRejection(loadPayments());
  });
});

onUnmounted(() => {
  stopSyncPass?.();
  stopSyncPass = null;
});
</script>

<template>
  <ListScreen>
    <p v-if="!loaded" class="empty">Loading…</p>
    <template v-else>
      <!-- The access list doubles as the standing table: each Member's name,
           Share and Owed figure, ruled off like the other screens' rows. -->
      <ul class="rows">
        <li
          v-for="row in memberRows"
          :key="row.memberId"
          class="member-standing"
          :class="row.className"
        >
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

    <section v-if="loaded && isOwner()">
      <h2>Invitations</h2>
      <p v-if="invitations.length === 0" class="empty">Nobody invited yet.</p>
      <ul v-else class="invitations">
        <li v-for="invitation in openInvitations" :key="invitation.id">
          <span>{{ invitation.email }}</span>
          <span class="invitation-status">({{ statusLabel(invitation.status) }})</span>
          <button
            v-if="invitation.status === 'pending'"
            type="button"
            name="revoke-invitation"
            :aria-label="`Revoke invitation for ${invitation.email}`"
            @click="onRevoke(invitation)"
          >
            Revoke
          </button>
        </li>
      </ul>
      <form class="invite-form" @submit.prevent="onInvite">
        <label>
          Email
          <input v-model="inviteForm.email" name="invite-email" type="email" />
        </label>
        <button type="submit" :disabled="inviteForm.submitting">Invite a member</button>
      </form>
    </section>
    <p v-else-if="loaded" class="leave-row">
      <button
        type="button"
        class="danger leave-list"
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
/* The standing table: the name on the left, the Share and the Owed figure on
   the right, the money in one column. The figures sit on the row's baseline so
   amounts read as a table even when a name wraps. */
li.member-standing {
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

/* Invitations sit below the Members, one row each with the revoke on the
   right edge. */
.invitations {
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-1);
    overflow-wrap: anywhere;
  }

  .invitation-status {
    color: var(--color-ink-muted);
  }

  button {
    margin-inline-start: auto;
    padding-inline: var(--space-2);
  }
}

/* The leave action reads as the text style of its siblings in the sheet. */
.leave-row {
  padding-block: var(--space-3);
}
</style>
