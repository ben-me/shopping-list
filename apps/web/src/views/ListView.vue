<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();
</script>

<template>
  <h1>List</h1>
  <p v-if="route.params.listId">List id: {{ route.params.listId }}</p>
</template>
