import { apiFetch } from "./api";

/**
 * Provision an account (ADR 0003): only the Admin can create household
 * accounts — better-auth's admin route turns anyone else away. Accounts are
 * created email-verified, so they can sign in immediately.
 */
export async function provisionUser(name: string, email: string, password: string) {
  await apiFetch("/api/auth/admin/create-user", {
    method: "POST",
    body: { name, email, password, role: "user", data: { emailVerified: true } },
  });
}
