import { NextIntlClientProvider, createTranslator } from "next-intl";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { resolveReviewToken } from "@/lib/reviews/service";
import { ReviewForm } from "./ReviewForm";

/**
 * The survey page.
 *
 * Public, no login — the token in the link is the authorisation, exactly as
 * the dispatch job sheet works (§4i). Force-dynamic because the answer depends
 * entirely on a token that must never be cached.
 *
 * Bilingual from the booking's own locale, which is the language every
 * notification for it was sent in.
 */
export const dynamic = "force-dynamic";

const CATALOGUES = { ar, en } as const;

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await resolveReviewToken(token);

  if (!result.ok) {
    // `not_found` and a tampered token answer identically; only "expired" is
    // named, because that tells a legitimate customer something useful and an
    // attacker nothing.
    const t = createTranslator({
      locale: "en",
      messages: CATALOGUES.en,
      namespace: "review",
    });
    const expired = result.reason === "expired";
    return (
      <main
        lang="en"
        dir="ltr"
        className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center"
      >
        <h1 className="text-ink text-2xl font-extrabold">
          {expired ? t("expiredTitle") : t("invalidTitle")}
        </h1>
        <p className="text-muted pt-3 text-lg">
          {expired ? t("expiredBody") : t("invalidBody")}
        </p>
      </main>
    );
  }

  const { invite } = result;
  const locale = invite.locale;
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ review: CATALOGUES[locale].review }}
      timeZone="Asia/Qatar"
    >
      <main
        lang={locale}
        dir={dir}
        className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12"
      >
        <ReviewForm token={token} invite={invite} />
      </main>
    </NextIntlClientProvider>
  );
}
