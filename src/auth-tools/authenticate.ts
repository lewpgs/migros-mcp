import { getJwt } from "../auth/index.js";
import { credsFromEnv } from "./_shared.js";

/**
 * Establish or reuse the authenticated Migros session.
 *
 * The caller supplies a current six-digit TOTP code only when a cached
 * session cannot be reused. The code is held only for this call and is never
 * written to the persisted session.
 */
export async function authenticate(args: { totpCode?: string } = {}): Promise<string> {
  await getJwt(credsFromEnv(args.totpCode));
  return JSON.stringify(
    {
      authenticated: true,
      message: "Migros authentication is ready. A cached session was reused when possible.",
    },
    null,
    2
  );
}
