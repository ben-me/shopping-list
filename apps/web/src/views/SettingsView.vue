<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { apiFetch } from "../api";
import { session, signOut } from "../session";

const router = useRouter();
const isAdmin = computed(() => session.user?.role === "admin");
const form = ref({
  name: "",
  email: "",
  password: "",
  error: null as string | null,
  submitting: false,
  createdName: null as string | null,
});

/**
 * Only the Admin creates accounts (ADR 0003): the route rejects anyone else
 * with a 403, and the form here is hidden for Members.
 */
async function addUser() {
  form.value.error = null;
  form.value.submitting = true;
  try {
    await apiFetch("/api/auth/admin/create-user", {
      method: "POST",
      body: {
        name: form.value.name,
        email: form.value.email,
        password: form.value.password,
        role: "user",
        data: { emailVerified: true },
      },
    });
  } catch (err) {
    form.value.error = err instanceof Error ? err.message : "Could not create the account";
    return;
  } finally {
    form.value.submitting = false;
  }
  form.value.createdName = form.value.name;
  form.value.name = "";
  form.value.email = "";
  form.value.password = "";
}

async function onSignOut() {
  await signOut();
  await router.push({ name: "sign-in" });
}
</script>

<template>
  <h1>Settings</h1>
  <div v-if="session.user">
    <p>Signed in as {{ session.user.name }}</p>
    <RouterLink :to="{ name: 'lists' }">Back to lists</RouterLink>
    <button type="button" @click="onSignOut">Sign out</button>
  </div>
  <section v-if="isAdmin" class="add-user" aria-label="Add a user">
    <h2>Add a user</h2>
    <p>Give a new household member their name, email, and password.</p>
    <form class="add-user-form" @submit.prevent="addUser">
      <label>
        Name
        <input v-model="form.name" name="add-user-name" />
      </label>
      <label>
        Email
        <input v-model="form.email" name="add-user-email" type="email" />
      </label>
      <label>
        Password
        <input
          v-model="form.password"
          name="add-user-password"
          type="password"
          autocomplete="new-password"
        />
      </label>
      <button type="submit" :disabled="form.submitting">Add user</button>
    </form>
    <p v-if="form.error">{{ form.error }}</p>
    <p v-if="form.createdName">{{ form.createdName }} can now sign in.</p>
  </section>
  <p v-if="!isAdmin">Only the Admin can manage users.</p>
</template>
