import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { warmServiceWorker } from "./pwa";

const app = createApp(App);

app.use(router);

app.mount("#app");

// The PWA shell installs and warms in the background; it must never delay
// first paint. Failures are swallowed inside warmServiceWorker.
void warmServiceWorker();
