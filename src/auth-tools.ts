import { api } from "./auth/api.js";
import type { Credentials } from "./auth/index.js";

/**
 * Read credentials from env. Returns undefined if not all vars are set, in
 * which case the auth layer falls back to a cached session if one exists.
 */
export function credsFromEnv(): Credentials | undefined {
  const email = process.env.MIGROS_EMAIL;
  const password = process.env.MIGROS_PASSWORD;
  if (!email || !password) return undefined;
  return { email, password, totpSecret: process.env.MIGROS_TOTP_SECRET };
}

/**
 * Fetch the logged-in customer's profile. Returns formatted JSON for the LLM.
 */
export async function getProfile(): Promise<string> {
  const profile = (await api(
    "GET",
    "/retentionapi/public/web/v1/customers/profile",
    undefined,
    { creds: credsFromEnv() }
  )) as Record<string, unknown>;

  return JSON.stringify(
    {
      userId: profile.userId,
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      languageCode: profile.languageCode,
      preferredCooperative: profile.preferredCooperative,
    },
    null,
    2
  );
}
