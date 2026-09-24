<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import AppBar from "../components/AppBar.vue";
import { isSignUpOpen, signIn, signUp } from "../session";

const router = useRouter();
const mode = ref<"sign-in" | "sign-up">("sign-in");
const name = ref("");
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);
const signUpOpen = ref(false);

onMounted(async () => {
  signUpOpen.value = await isSignUpOpen();
});

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
  <AppBar :title="mode === 'sign-in' ? 'Sign in' : 'Sign up'" />
  <main class="page">
    <section aria-label="Sign in">
      <form @submit.prevent="onSubmit">
        <template v-if="mode === 'sign-up'">
          <label>
            Name
            <input v-model="name" name="name" />
          </label>
        </template>
        <label>
          Email
          <input v-model="email" type="email" name="email" />
        </label>
        <label>
          Password
          <input v-model="password" type="password" name="password" />
        </label>
        <button type="submit" :disabled="submitting">
          {{ mode === "sign-in" ? "Sign in" : "Sign up" }}
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <button v-if="signUpOpen" type="button" @click="toggleMode">
        {{ mode === "sign-in" ? "Create an account" : "Have an account?" }}
      </button>
    </section>
  </main>
</template>

<style scoped>
/* The one page with nothing else to look at: centre the form in the sheet. */
section {
  margin-block-start: var(--space-6);
}
</style>
