import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { prepareServiceWorker } from "./pwa";

const app = createApp(App);

app.use(router);

app.mount("#app");

// The PWA shell installs in the background; it must never delay first paint.
prepareServiceWorker();
