import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "../App.vue";
import { createAppRouter } from "../router";

describe("App", () => {
  it("mounts the router shell and renders the home view at /", async () => {
    const router = createAppRouter(createMemoryHistory());
    router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });

    expect(wrapper.text()).toContain("Shopping Lists");
  });

  it("mounts the List view at /list/:listId without throwing", async () => {
    const router = createAppRouter(createMemoryHistory());
    router.push("/list/list-1");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [router] } });

    expect(wrapper.text()).toContain("List");
    expect(wrapper.text()).toContain("list-1");
  });
});
