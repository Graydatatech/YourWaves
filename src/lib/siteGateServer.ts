import "server-only";

import { getSiteOpen } from "@/db/queries";
import { isSiteLocked } from "@/lib/siteGate";

/**
 * Whether the gate is actually asking for a password right now — for server
 * code that CAN reach the database (the /access page and its API), unlike the
 * proxy, which goes through isSiteOpen() and its memo.
 *
 * A read failure counts as "still asking": the same closed-on-error choice the
 * proxy makes, so the two can never disagree in the direction of letting
 * somebody through.
 */
export async function isGateActive(): Promise<boolean> {
  if (!isSiteLocked()) return false;
  try {
    return !(await getSiteOpen());
  } catch {
    return true;
  }
}
