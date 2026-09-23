import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { prepareServiceWorker } from "./pwa";
// Self-hosted so the shell renders the same offline as online.
import "@fontsource-variable/archivo/wdth.css";
import "./assets/reset.css";
import "./assets/styles.css";

const app = createApp(App);

app.use(router);

app.mount("#app");

// The PWA shell installs in the background; it must never delay first paint.
prepareServiceWorker();
