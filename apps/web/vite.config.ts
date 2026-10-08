// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults } from "vitest/config";

// https://vite.dev/config/

// The e2e stage (`dev:e2e` in apps/api sets ALCHEMY_STAGE) pins the dev
// layout to :5174 / :8788 so it never collides with interactive dev.
const isE2E = process.env.ALCHEMY_STAGE === "e2e";

export default defineConfig({
  server: {
    host: true,
    port: isE2E ? 5174 : 5173,
    proxy: { "/api": `http://localhost:${isE2E ? 8788 : 8787}` },
  },
  plugins: [
    vue(),
    vueDevTools(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon.svg"],
      manifest: {
        name: "Shopping List",
        short_name: "Shopping List",
        description: "A household's shared shopping lists and who paid what.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#191b1c",
        icons: [
          { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The shell only, never /api: the local Store is the read
            // source, so cached API responses would be stale data served as
            // if it were fresh. In a production build the precache already
            // covers the hashed assets; this route is what makes the dev
            // server (no build output to precache) work offline.
            urlPattern: ({ request, url }: { request: Request; url: URL }) =>
              request.method === "GET" &&
              url.origin === self.location.origin &&
              !url.pathname.startsWith("/api"),
            handler: "NetworkFirst",
            options: { cacheName: "shell-cache" },
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallbackAllowlist: [/^(?!\/api(\/|$)).*/],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    root: fileURLToPath(new URL("./", import.meta.url)),
    globals: true,
  },
});
