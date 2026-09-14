#!/usr/bin/env node
//
// Wipe the LOCAL dev D1 database (wrangler dev's on-disk sqlite state), so a
// fresh `pnpm test:e2e` run always starts from an empty database. This is the
// reset half of the bootstrap flow: with an empty user table, sign-up runs
// once to create the Admin, then closes for good (ADR 0003).
//
// Only the local state under `apps/api/.wrangler` is touched — never a remote
// D1 binding. The database is recreated by `pnpm --filter @shopping-list/api
// db:migrate`, which the e2e webServer command runs right after this.

import { readdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const d1Dir = join(apiDir, ".wrangler", "state", "v3", "d1");

async function wipe() {
  let removed = 0;
  try {
    const entries = await readdir(d1Dir);
    for (const entry of entries) {
      const path = join(d1Dir, entry);
      const statResult = await stat(path);
      if (statResult.isDirectory()) {
        for (const file of await readdir(path)) {
          if (/\.sqlite(-wal|-shm)?$/.test(file)) {
            await rm(join(path, file));
            removed += 1;
          }
        }
      }
    }
  } catch (error) {
    // No local state yet — nothing to wipe.
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  console.log(
    removed > 0
      ? `db:reset wiped ${removed} local D1 file(s).`
      : "db:reset: no local D1 state to wipe.",
  );
}

wipe().catch((error) => {
  console.error(`db:reset failed: ${error.message ?? error}`);
  process.exit(1);
});
