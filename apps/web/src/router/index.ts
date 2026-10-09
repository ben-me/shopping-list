import { createRouter, createWebHistory, type RouterHistory } from "vue-router";
import { revalidateSession, restoreSession, session, signingOut } from "../session";
import ListsView from "../views/ListsView.vue";
import ListLayout from "../views/ListLayout.vue";
import ListView from "../views/ListView.vue";
import MembersView from "../views/MembersView.vue";
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
      {
        // The List's chrome — app bar and section tabs — lives here, so the
        // tabs stay mounted while its screens swap beneath them and the
        // selection underline can glide from section to section.
        path: "/list/:listId",
        component: ListLayout,
        meta: { requiresAuth: true },
        children: [
          { path: "", name: "list", component: ListView },
          { path: "payments", name: "list-payments", component: PaymentsView },
          { path: "members", name: "list-members", component: MembersView },
        ],
      },
    ],
  });

  // The first navigation is the boot: the session must be known before any
  // route resolves, so the guard waits for that one fetch. Every later
  // navigation resolves synchronously from the session in hand and only
  // revalidates in the background — a tab switch never waits on the network.
  let sessionBooted = false;

  router.beforeEach(async (to) => {
    if (sessionBooted) {
      revalidateSession();
    } else {
      sessionBooted = true;
      await restoreSession();
    }
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
