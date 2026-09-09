import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pin the root to this package. Without it vitest climbs to the workspace
// root, where a shared pnpm store (`.pnpm-store/v11/projects/*`) symlinks
// this worktree's packages back into the glob and every test file runs
// twice — once as itself, once through the store link.
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
});
