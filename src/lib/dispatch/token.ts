import "server-only";

import { createHash } from "node:crypto";

/**
 * The dispatch link is a capability: whoever holds it can see a customer's home
 * address and move the job along. There is no login behind it, so the token IS
 * the authorisation, and everything here exists to keep that honest.
 *
 * The token is minted in SQL (`mint_dispatch_token()`) so the payment webhook's
 * trigger can create one inside the same transaction as the confirmation. Only
 * the HASH is stored, so a leaked database row cannot be turned back into a
 * working link.
 */

/**
 * SHA-256, hex — deliberately the same function `mint_dispatch_token()` uses.
 *
 * Not bcrypt: the token is looked up by hash on every page open, which needs an
 * indexed equality match, and a 32-byte random secret has no dictionary to
 * attack. bcrypt's work factor protects low-entropy passwords, not this.
 */
export function hashDispatchToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A token is 32 random bytes in base64url — 43 characters, no padding.
 *
 * Checked before the database is touched, so a scanner throwing junk at /d/
 * costs a regex rather than a query. Deliberately a range rather than exactly
 * 43, so changing the token size later does not 404 every live link.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,64}$/;

export function looksLikeDispatchToken(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}
