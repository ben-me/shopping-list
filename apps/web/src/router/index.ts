import { createRouter, createWebHistory, type RouterHistory } from "vue-router";
import ListsView from "../views/ListsView.vue";
import ListView from "../views/ListView.vue";

export function createAppRouter(
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  return createRouter({
    history,
    routes: [
      { path: "/", name: "lists", component: ListsView },
      { path: "/list/:listId", name: "list", component: ListView },
    ],
  });
}

export default createAppRouter();
