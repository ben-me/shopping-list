import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["vue", "typescript", "unicorn", "oxc", "eslint", "vitest"],
  jsPlugins: ["eslint-plugin-playwright"],
  categories: {
    correctness: "error",
  },
});
