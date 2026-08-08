import createMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import {
  SITE_GATE_PATH,
  isRequestAllowed,
  isSiteLocked,
} from "@/lib/siteGate";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`.
 * next-intl still ships its factory under `next-intl/middleware`; only the
 * Next.js-facing file name and export name changed.
 *
 * Three responsibilities, in this order:
 *
 *   the pre-launch gate — while SITE_PASSWORD is set, the public site asks for
 *                it first. FIRST, because a locked site must not answer
 *                anything about itself: run the locale rewrite before the gate
 *                and `/` still redirects to `/ar`, which tells a stranger the
 *                site exists, is bilingual and defaults to Arabic. Unset, this
 *                costs one string comparison per request.
 *   /admin/*   — the back-office gate. No session, no page. Enforced HERE
 *                rather than only in a layout, because a layout check can be
 *                defeated by a client-side route transition and does nothing
 *                for a directly-requested RSC payload.
 *   everything else — locale routing: `/` → `/ar`, reject unknown prefixes.
 */

const intlProxy = createMiddleware(routing);

/** Reachable without a session; everything else under /admin is not. */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/mfa", "/admin/auth"];

function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Refreshes the Supabase session and reports whether one exists.
 *
 * The refresh matters as much as the check: access tokens are short-lived, and
 * without a middleware pass a long-lived admin tab would find itself signed out
 * mid-action. Cookies set on `response` here are the ones the browser keeps.
 */
async function readSession(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { configured: false, userId: null };

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { configured: true, userId: user?.id ?? null };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /**
   * The pre-launch gate, before anything else.
   *
   * `isRequestAllowed` short-circuits to true when SITE_PASSWORD is unset, so
   * this is inert on a launched site. Its exemption list — /api, /admin, /d,
   * /r, static assets — is the part that matters and lives in one place, next
   * to the reason for each entry.
   */
  if (isSiteLocked() && !isRequestAllowed(request)) {
    const url = request.nextUrl.clone();
    url.pathname = SITE_GATE_PATH;
    url.search = "";
    // Where they were going, so the form can put them back rather than
    // dropping them on the home page. Only a path, never a full URL: an
    // absolute value here would make this an open redirect.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const isAdminApi = pathname.startsWith("/api/admin");
  const isAdminPage = pathname.startsWith("/admin");

  if (!isAdminApi && !isAdminPage) {
    return intlProxy(request);
  }

  const response = NextResponse.next({ request });
  const { configured, userId } = await readSession(request, response);

  // Without a Supabase project there is no way to authenticate anyone, so the
  // back office is closed rather than open. The login page renders its own
  // explanation of what is missing.
  if (!configured) {
    // An API route must answer with a STATUS, never a redirect. A `fetch`
    // follows redirects by default, so returning one here would hand the
    // caller a 200 carrying the login page — which looks like success to
    // anything that only checks `response.ok`.
    if (isAdminApi) {
      return Response.json(
        { error: "not_configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (pathname === "/admin/login") return response;
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("reason", "not_configured");
    return NextResponse.redirect(url);
  }

  if (isAdminPage && isPublicAdminPath(pathname)) {
    /**
     * Already signed in and heading for the login form: send them inside.
     *
     * UNLESS the URL carries a `reason`. That parameter means a layer BEHIND
     * this one — the dashboard layout, which unlike the proxy can reach the
     * database — deliberately sent them here to be told something, and the only
     * thing it says is "your session is fine but you are not authorised".
     * Bouncing them back to /admin makes the two layers redirect at each other
     * forever: the browser gives up with ERR_TOO_MANY_REDIRECTS and the user is
     * never told why.
     *
     * That is not hypothetical. A Supabase user with no `user_roles` row — or
     * an app pointed at a database that does not have their row, which is what
     * a stale server on the wrong DATABASE_URL looks like — hits it every time.
     */
    if (
      userId &&
      pathname === "/admin/login" &&
      !request.nextUrl.searchParams.has("reason")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!userId) {
    // API routes get a status code; a browser gets the login page with a
    // `next` param so the deep link survives the round trip.
    if (isAdminApi) {
      return Response.json(
        { error: "signed_out" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // A session exists. The MFA gate and the role lookup need the database, which
  // is not available in the proxy — they run in the admin layout and in
  // requireAdmin() on every API route. This layer is the coarse filter that
  // makes an unauthenticated request impossible, not the whole policy.
  return response;
}

export const config = {
  /**
   * Everything except Next internals and static assets.
   *
   * `api` is excluded from the locale rewrite — sending /api/bookings through
   * next-intl would redirect it to /ar/api/bookings and break every customer
   * route. /api/admin/* still needs the session check, so it is matched
   * separately and dispatched by the branch above.
   * `dev`, `d/`, `r/` and `access` are excluded: /dev/emails is a locale-less
   * developer tool, /d/<token> is the public dispatch link, /r/<token> the
   * survey link and /access the pre-launch gate. None has a locale segment —
   * each takes its language from the booking, or shows both — so a locale
   * rewrite would redirect a working link to a 404, and would bounce the gate
   * page to /ar/access before anybody could type into it.
   */
  matcher: [
    // Customer API routes must NOT go through the locale rewrite, so `api` is
    // excluded here and the admin subtree is matched explicitly below.
    "/((?!api|dev|d/|r/|access|_next|_vercel|.*\\..*).*)",
    "/api/admin/:path*",
  ],
};
