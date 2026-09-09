import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["dev-dist"],
  plugins: ["vue", "typescript", "unicorn", "oxc", "eslint", "vitest"],
  jsPlugins: ["eslint-plugin-playwright"],
  rules: {
    "vitest/no-importing-vitest-globals": "error",
  },
  categories: {
    correctness: "error",
  },
});
