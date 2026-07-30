"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { supabaseBrowser } from "@/lib/admin/supabaseBrowser";
import { cn } from "@/lib/cn";

/**
 * The mandatory second factor.
 *
 * Two situations, one screen, because from the admin's point of view they are
 * the same moment ("prove it's you"):
 *
 *   ENROL     — no verified factor exists. Supabase returns a TOTP secret and
 *               a QR code; verifying the first code completes enrolment.
 *   CHALLENGE — a factor exists but this session is still aal1.
 *
 * There is deliberately no "skip". SRS wants MFA mandatory for admins, and the
 * server enforces that independently: getAdminSession() treats an aal1 session
 * as signed out, so a client that skipped this screen would simply bounce back.
 */

type Mode = "loading" | "enrol" | "challenge" | "error";

export function MfaFlow({ next }: { next: string }) {
  const t = useTranslations("admin");

  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enrolment is not idempotent, and React 19 runs effects twice in
  // development, so this guards against a duplicate call within one mount.
  // It cannot guard against a RELOAD, which is why the friendly name below is
  // unique per attempt.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const supabase = supabaseBrowser();
        const { data: factors, error: listError } =
          await supabase.auth.mfa.listFactors();

        if (listError) {
          setMode("error");
          setError(listError.message);
          return;
        }

        /**
         * `factors.totp` contains only VERIFIED factors — an abandoned
         * enrolment is invisible there. `factors.all` is the complete list, and
         * using the wrong one is why this screen failed: the orphan from a
         * previous visit was never cleaned up, and the enrol call below then
         * collided with its name.
         */
        const totp = (factors?.all ?? []).filter(
          (factor) => factor.factor_type === "totp",
        );

        const verified = totp.find((factor) => factor.status === "verified");
        if (verified) {
          setFactorId(verified.id);
          setMode("challenge");
          return;
        }

        // Clear every abandoned enrolment. The QR code is only returned when a
        // factor is created, so a half-finished one cannot be resumed — it can
        // only be replaced.
        for (const orphan of totp) {
          await supabase.auth.mfa.unenroll({ factorId: orphan.id });
        }

        const { data, error: enrolError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          /**
           * UNIQUE PER ATTEMPT. Supabase rejects a duplicate friendly name with
           * `mfa_factor_name_conflict` (422), so a constant name means the
           * second visit to this screen can never enrol — which is exactly the
           * bug this replaced.
           */
          friendlyName: `YourWaves ops ${crypto.randomUUID().slice(0, 8)}`,
        });

        if (enrolError || !data) {
          setMode("error");
          // The provider's own words. A generic "could not start enrolment"
          // sent the last diagnosis down a blind alley.
          setError(enrolError?.message ?? t("mfa.enrolFailed"));
          return;
        }

        setFactorId(data.id);
        setQr(data.totp.qr_code);
        setSecret(data.totp.secret);
        setMode("enrol");
      } catch (error) {
        setMode("error");
        setError(error instanceof Error ? error.message : t("mfa.enrolFailed"));
      }
    })();
  }, [t]);

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !factorId) return;

    setPending(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });

      if (challengeError || !challenge) {
        setError(challengeError?.message ?? t("mfa.invalidCode"));
        setPending(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });

      if (verifyError) {
        // A wrong code is by far the likeliest cause, but not the only one —
        // show what the server said when it is something else.
        setError(
          /invalid|incorrect|expired/i.test(verifyError.message)
            ? t("mfa.invalidCode")
            : verifyError.message,
        );
        setCode("");
        setPending(false);
        return;
      }

      // The session is now aal2. A full navigation, not router.push: the
      // server layout must re-read the refreshed cookie.
      window.location.assign(next);
    } catch {
      setError(t("mfa.invalidCode"));
      setPending(false);
    }
  }

  if (mode === "loading") {
    return <p className="text-muted text-sm">{t("common.loading")}</p>;
  }

  if (mode === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p
          role="alert"
          className="rounded-input bg-[#fdeceb] px-3.5 py-2.5 text-sm text-[#b3261e]"
        >
          {error}
        </p>
        <form action="/admin/auth/signout" method="post">
          <button
            type="submit"
            className="text-accent-strong min-h-11 text-sm font-semibold underline"
          >
            {t("mfa.signOut")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-ink-deep text-2xl font-extrabold tracking-tight">
          {mode === "enrol" ? t("mfa.enrolTitle") : t("mfa.challengeTitle")}
        </h1>
        <p className="text-muted pt-2 text-sm leading-relaxed">
          {mode === "enrol" ? t("mfa.enrolBody") : t("mfa.challengeBody")}
        </p>
      </div>

      {mode === "enrol" && qr ? (
        <div className="border-border bg-surface rounded-card flex flex-col items-center gap-3 border p-4">
          {/* Supabase returns the QR as an inline SVG data URI, so there is no
              remote image and nothing to block. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt=""
            width={200}
            height={200}
            className="size-[200px]"
          />
          {secret ? (
            <div className="w-full text-center">
              <p className="text-muted-2 text-xs font-semibold">
                {t("mfa.secretLabel")}
              </p>
              <code className="text-ink mt-1 block font-mono text-sm break-all">
                {secret}
              </code>
            </div>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={handleVerify} className="flex flex-col gap-3">
        <label htmlFor="mfa-code" className="text-ink text-sm font-semibold">
          {t("mfa.code")}
        </label>
        <input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={code}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          className={cn(
            "border-border bg-surface rounded-input min-h-14 border px-4",
            // Tracking makes six digits readable at a glance; 20px is well
            // above the 16px iOS zoom threshold.
            "text-center text-xl font-bold tracking-[0.4em] outline-none",
            "focus:border-accent",
          )}
        />

        {error ? (
          <p
            role="alert"
            className="rounded-input bg-[#fdeceb] px-3.5 py-2.5 text-sm text-[#b3261e]"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className={cn(
            "bg-accent rounded-pill min-h-12 px-6 text-base font-bold text-white",
            "disabled:opacity-60",
          )}
        >
          {pending ? t("mfa.verifying") : t("mfa.verify")}
        </button>
      </form>

      <form action="/admin/auth/signout" method="post">
        <button
          type="submit"
          className="text-muted-2 hover:text-ink min-h-11 text-sm font-semibold"
        >
          {t("mfa.signOut")}
        </button>
      </form>
    </div>
  );
}
