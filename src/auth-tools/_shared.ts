import type { Credentials } from "../auth/index.js";

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
