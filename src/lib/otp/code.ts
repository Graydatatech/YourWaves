import "server-only";

import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * One-time code generation and hashing.
 *
 * SRS 3.5 specifies a 4-digit code. Four digits is only 10,000 possibilities, so
 * the hash is NOT what makes this safe against guessing — the attempt limit is
 * (5 tries per code, then the code is burned). Storing a hash protects the codes
 * at rest if the database is ever exposed; it does not protect a live code from
 * being brute-forced, which is why the counter is enforced in the same
 * transaction as the comparison.
 */

export const CODE_LENGTH = 4;
export const CODE_TTL_SECONDS = 5 * 60;
export const MAX_ATTEMPTS = 5;

/**
 * `randomInt` is a CSPRNG with rejection sampling, so every code in
 * 0000–9999 is equally likely. `Math.random()` would be both predictable and
 * slightly biased once scaled.
 */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * Cost 10: roughly 50-80ms on the server. High enough to be a real barrier at
 * rest, low enough that a verify request stays responsive on a mobile network
 * where the round trip already dominates.
 */
const BCRYPT_COST = 10;

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_COST);
}

/**
 * Compares a submitted code against a stored hash.
 *
 * bcrypt.compare re-derives the hash with the stored salt and compares the
 * digests in constant time, so a wrong code takes the same time whether the
 * first digit differs or the last.
 */
export async function verifyCode(code: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(code, hash);
  } catch {
    // Malformed hash in the row — treat as a failed attempt, never as success.
    return false;
  }
}

/** Cheap shape check before spending a bcrypt comparison on obvious junk. */
export function looksLikeCode(value: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value);
}
