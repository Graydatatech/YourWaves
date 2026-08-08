import { cookies } from "next/headers";
import { z } from "zod";
import {
  SITE_GATE_COOKIE,
  gateCookieOptions,
  isCorrectPassword,
  isSiteLocked,
  issueGateToken,
} from "@/lib/siteGate";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z.object({
  password: z.string().min(1).max(200),
  next: z.string().max(512).optional(),
});

/** A path inside this site, or "/". See the note on the page's copy of this. */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  // Reject BOTH "//host" and "/\\host". A leading slash-backslash has no
  // scheme and looks relative, but Chrome and Firefox normalise it to "//" and
  // navigate off-site — it is the form of this bug that survives the obvious
  // check.
  if (value[1] === "/" || value[1] === "\\") return "/";
  return value;
}

/**
 * POST /api/access — exchange the passcode for a cookie.
 *
 * Answers a STATUS and a JSON body rather than a redirect. `fetch` follows
 * redirects by default, so returning one would hand the caller a 200 carrying
 * whatever page it landed on — indistinguishable from success to anything
 * checking `response.ok`. The same mistake `pnpm check:admin-auth` was written
 * to catch on the admin routes (§4h).
 *
 * Exempt from the gate itself, in siteGate's isExempt — a locked site that
 * blocked the endpoint for opening the lock would be a closed loop.
 */
export async function POST(request: Request) {
  if (!isSiteLocked()) {
    // No password configured: nothing to grant, and no cookie to mint. Not an
    // error — the caller simply has nowhere to be let into.
    return Response.json(
      { ok: true, redirectTo: "/" },
      { status: 200, headers: NO_STORE },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "invalid_request" },
      { status: 422, headers: NO_STORE },
    );
  }

  if (!isCorrectPassword(parsed.data.password)) {
    /*
     * No rate limit here, and that is a considered omission rather than an
     * oversight. This gate is not a security boundary — see the header of
     * siteGate.ts — and the things worth brute-forcing are behind real auth.
     * Adding a limiter would mean a table, a sweep and a lockout path for a
     * door whose only job is to keep an unfinished site off Google.
     *
     * If this ever becomes the only thing in front of something that matters,
     * that reasoning stops holding and request_otp()'s SQL limiter is the
     * shape to copy.
     */
    return Response.json(
      { ok: false, error: "wrong_password" },
      { status: 401, headers: NO_STORE },
    );
  }

  const jar = await cookies();
  jar.set(SITE_GATE_COOKIE, issueGateToken(), gateCookieOptions());

  return Response.json(
    { ok: true, redirectTo: safeNext(parsed.data.next) },
    { status: 200, headers: NO_STORE },
  );
}
