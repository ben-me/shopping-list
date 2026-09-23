<script setup lang="ts">
import MembersList from "./MembersList.vue";

/** The List's sections: Items, Payments, and the household behind them. */
defineProps<{ listId: string }>();
</script>

<template>
  <RouterLink class="tab" :to="{ name: 'list', params: { listId } }">Items</RouterLink>
  <RouterLink class="tab" :to="{ name: 'list-payments', params: { listId } }">Payments</RouterLink>
  <MembersList :list-id="listId" />
</template>
