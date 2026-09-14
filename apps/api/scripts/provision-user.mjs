#!/usr/bin/env node
//
// Provision a household account through the admin route (ADR 0003).
//
//   pnpm --filter @shopping-list/api user:create -- --name "Alice" --email alice@example.com
//
// The Admin's credentials come from --admin-email/--admin-password or the
// ADMIN_EMAIL/ADMIN_PASSWORD environment variables; the API base URL from
// --api or API_BASE_URL (default http://localhost:8787). The account is
// email-verified by provisioning, so the new user can sign in immediately.
// Passwords fall back to a randomly generated one that is printed once.

import { randomBytes } from "node:crypto";

function fail(message) {
  console.error(`user:create: ${message}`);
  process.exit(1);
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function envOrFlag(envName, flagName) {
  return process.env[envName] ?? flag(flagName);
}

async function main() {
  const baseURL = (process.env.API_BASE_URL ?? flag("api") ?? "http://localhost:8787").replace(
    /\/+$/,
    "",
  );
  const adminEmail = envOrFlag("ADMIN_EMAIL", "admin-email");
  const adminPassword = envOrFlag("ADMIN_PASSWORD", "admin-password");
  const name = flag("name");
  const email = flag("email");
  const password = flag("password") ?? randomPassword();

  if (!name || !email) {
    fail("--name and --email are required");
  }
  if (!adminEmail || !adminPassword) {
    fail(
      "the Admin's credentials are required (--admin-email/--admin-password or ADMIN_EMAIL/ADMIN_PASSWORD)",
    );
  }

  const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (!signIn.ok) {
    fail(
      `could not sign in the Admin (${signIn.status}) — is the API running and is the Admin account correct?`,
    );
  }
  const cookie = signIn.headers.getSetCookie().join("; ");

  const created = await fetch(`${baseURL}/api/auth/admin/create-user`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, email, password, role: "user", data: { emailVerified: true } }),
  });
  if (!created.ok) {
    const body = await created.json().catch(() => ({}));
    fail(`provisioning failed (${created.status}): ${body.message ?? created.statusText}`);
  }

  const { user } = await created.json();
  console.log(`Provisioned ${user.email} (id ${user.id}).`);
  if (!flag("password")) {
    console.log(`Password kept from the one-time generator: ${password}`);
  }
}

function randomPassword() {
  const bytes = randomBytes(12);
  return `provis-${Buffer.from(bytes)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16)}`;
}

main().catch((error) => fail(error.message ?? String(error)));
