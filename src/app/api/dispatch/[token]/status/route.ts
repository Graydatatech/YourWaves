import { z } from "zod";
import {
  clientIp,
  resolveDispatchToken,
  type DispatchRefusal,
} from "@/lib/dispatch/service";
import {
  applyDispatchAction,
  isDispatchAction,
} from "@/lib/dispatch/actions";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z.object({
  action: z.string(),
  /**
   * Generated on the device, stable across retries of the SAME tap. This is
   * what makes the offline queue safe to replay.
   */
  clientActionId: z.string().trim().min(8).max(64),
});

/**
 * POST /api/dispatch/[token]/status
 *
 * The only write a dispatch link can perform. No session — the token is the
 * authorisation — so every refusal is deliberately indistinguishable from
 * outside, and the legal state machine is enforced in SQL rather than here.
 */
const REFUSAL_STATUS: Record<DispatchRefusal, number> = {
  malformed: 404,
  not_found: 404,
  expired: 410,
  revoked: 410,
  rate_limited: 429,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const resolved = await resolveDispatchToken(
    token,
    { ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") },
    // A background POST is not "the recipient looked at the job".
    { markOpened: false },
  );

  if (!resolved.ok) {
    return Response.json(
      { error: resolved.reason },
      { status: REFUSAL_STATUS[resolved.reason], headers: NO_STORE },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isDispatchAction(parsed.data.action)) {
    return Response.json(
      { error: "invalid_action" },
      { status: 422, headers: NO_STORE },
    );
  }

  try {
    const result = await applyDispatchAction(
      resolved.job,
      parsed.data.action,
      parsed.data.clientActionId,
    );

    if (result.outcome === "illegal_transition") {
      return Response.json(
        { error: "illegal_transition", status: result.status },
        { status: 409, headers: NO_STORE },
      );
    }

    // `duplicate` and `already_done` are successes: the queue replayed
    // something that has, in fact, happened. Returning an error would make the
    // device retry forever or show a failure for a real update.
    return Response.json(
      { ok: true, outcome: result.outcome, status: result.status },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[dispatch] action failed", {
      dispatchId: resolved.job.dispatchId,
      action: parsed.data.action,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "action_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}
