<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { signIn, signUp } from "../session";

const router = useRouter();
const mode = ref<"sign-in" | "sign-up">("sign-in");
const name = ref("");
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);

async function onSubmit() {
  error.value = null;
  submitting.value = true;
  try {
    if (mode.value === "sign-in") {
      await signIn(email.value, password.value);
    } else {
      await signUp(name.value, email.value, password.value);
    }
    await router.push({ name: "lists" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Something went wrong";
  } finally {
    submitting.value = false;
  }
}

function toggleMode() {
  mode.value = mode.value === "sign-in" ? "sign-up" : "sign-in";
  error.value = null;
}
</script>

<template>
  <h1>{{ mode === "sign-in" ? "Sign in" : "Sign up" }}</h1>
  <form @submit.prevent="onSubmit">
    <template v-if="mode === 'sign-up'">
      <label>
        Name
        <input v-model="name" data-testid="name" />
      </label>
    </template>
    <label>
      Email
      <input v-model="email" type="email" data-testid="email" />
    </label>
    <label>
      Password
      <input v-model="password" type="password" data-testid="password" />
    </label>
    <button type="submit" :disabled="submitting">
      {{ mode === "sign-in" ? "Sign in" : "Sign up" }}
    </button>
  </form>
  <p v-if="error" data-testid="form-error">{{ error }}</p>
  <button type="button" @click="toggleMode">
    {{ mode === "sign-in" ? "Create an account" : "Have an account?" }}
  </button>
</template>
