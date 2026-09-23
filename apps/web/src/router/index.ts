import { createRouter, createWebHistory, type RouterHistory } from "vue-router";
import { restoreSession, session, signingOut } from "../session";
import ListsView from "../views/ListsView.vue";
import ListView from "../views/ListView.vue";
import PaymentsView from "../views/PaymentsView.vue";
import SignInView from "../views/SignInView.vue";
import SettingsView from "../views/SettingsView.vue";

export function createAppRouter(
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  const router = createRouter({
    history,
    routes: [
      { path: "/sign-in", name: "sign-in", component: SignInView, meta: { guestOnly: true } },
      { path: "/", name: "lists", component: ListsView, meta: { requiresAuth: true } },
      {
        path: "/settings",
        name: "settings",
        component: SettingsView,
        meta: { requiresAuth: true },
      },
      { path: "/list/:listId", name: "list", component: ListView, meta: { requiresAuth: true } },
      {
        path: "/list/:listId/payments",
        name: "list-payments",
        component: PaymentsView,
        meta: { requiresAuth: true },
      },
    ],
  });

  router.beforeEach(async (to) => {
    await restoreSession();
    if (to.meta.requiresAuth && !session.user) {
      return { name: "sign-in" };
    }
    if (to.meta.guestOnly && session.user && !signingOut) {
      return { name: "lists" };
    }
  });

  return router;
}

export default createAppRouter();
