import { redirect } from "next/navigation";
import { isSiteLocked } from "@/lib/siteGate";
import { AccessForm } from "./AccessForm";

/**
 * The pre-launch gate.
 *
 * `force-dynamic` because the answer depends on an environment variable and a
 * cookie. Statically rendered, this page would be baked at build time and
 * would still be served after SITE_PASSWORD was removed.
 */
export const dynamic = "force-dynamic";

/**
 * A path inside this site, or "/".
 *
 * `next` comes from the query string, so it is attacker-controlled: without
 * this, `?next=https://example.com` would turn the gate into an open redirect
 * that borrows our domain's credibility. A protocol-relative `//host` is the
 * one that gets missed — it has no scheme but is still absolute — so the test
 * is "starts with exactly one slash", not "starts with a slash".
 */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  // Reject BOTH "//host" and "/\\host". A leading slash-backslash has no
  // scheme and looks relative, but Chrome and Firefox normalise it to "//" and
  // navigate off-site — it is the form of this bug that survives the obvious
  // check.
  if (value[1] === "/" || value[1] === "\\") return "/";
  return value;
}

export default async function AccessPage({
  searchParams,
}: {
  // A Promise in Next 16 — synchronous access to searchParams was removed.
  searchParams: Promise<{ next?: string }>;
}) {
  // Nothing to ask for once the site is open. Somebody who bookmarked this
  // page should land on the site, not on a form with no purpose.
  if (!isSiteLocked()) redirect("/");

  const next = safeNext((await searchParams).next);

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p
          aria-hidden="true"
          className="bg-brand mx-auto size-14 rounded-2xl"
        />

        <h1 className="text-ink mt-6 text-center text-2xl font-extrabold">
          <span dir="rtl">قريبًا</span>
          <span dir="ltr" className="text-muted block text-lg font-bold">
            Launching soon
          </span>
        </h1>

        <p className="text-muted mt-4 text-center text-[15px] leading-relaxed">
          <span dir="rtl" className="block">
            هذا الموقع قيد الإعداد. أدخل كلمة المرور للاطّلاع عليه.
          </span>
          <span dir="ltr" className="mt-2 block">
            This site is not public yet. Enter the password to preview it.
          </span>
        </p>

        <AccessForm next={next} />
      </div>
    </main>
  );
}
