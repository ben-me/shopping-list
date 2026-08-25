import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["vue", "typescript", "eslint", "vitest"],
  jsPlugins: ["eslint-plugin-playwright"],
});
