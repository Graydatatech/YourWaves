"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { PaymentsStatus } from "@/lib/payments/status";
import { ConfirmSheet } from "../../components/ConfirmSheet";

type TestResult = {
  ok: boolean;
  outcome: string;
  message: string;
  redirectUrl?: string;
  providerRef?: string;
};

/**
 * Read-only view of the payment gateway configuration, plus a live test.
 *
 * NOTHING HERE IS EDITABLE, and that is the design rather than an omission —
 * see the long note in `src/lib/payments/status.ts`. The short version: the
 * SkipCash secret signs requests that move money and the webhook key is the
 * only thing between a stranger and a confirmed booking, so they stay in the
 * deployment environment instead of in a table this application reads as the
 * table owner. What the office needed was not editing but visibility.
 *
 * So the panel answers three questions and nothing else: is payment switched
 * on, is it pointed at the sandbox or at production, and does it work right now.
 */
export function PaymentsPanel({ status }: { status: PaymentsStatus }) {
  const t = useTranslations("admin");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isProduction = status.environment === "production" && !status.isMock;

  async function runTest(confirm = false) {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/payments/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const body = await response.json().catch(() => null);

      // 409 = the production acknowledgement gate. Everything else that is not
      // a successful diagnostic is a genuine failure of the endpoint itself.
      if (response.status === 409) {
        setConfirmOpen(true);
        return;
      }
      if (!response.ok || !body?.result) {
        setResult({
          ok: false,
          outcome: "error",
          message: body?.message ?? t("payments.testFailed"),
        });
        return;
      }
      setResult(body.result as TestResult);
    } catch {
      setResult({
        ok: false,
        outcome: "error",
        message: t("payments.testFailed"),
      });
    } finally {
      setTesting(false);
    }
  }

  const envTone =
    status.environment === "production"
      ? "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]"
      : status.environment === "sandbox"
        ? "bg-[#fff7ed] text-[#92400e] border-[#fcd9a4]"
        : "bg-[#f1f5f9] text-[#5f6e84] border-[#cbd5e1]";

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("payments.title")}
        </h2>

        <span
          className={cn(
            "rounded-pill border px-2.5 py-1 text-xs font-bold",
            envTone,
          )}
        >
          {status.isMock
            ? t("payments.envMock")
            : t(`payments.env.${status.environment}`)}
        </span>
      </div>

      <p className="text-muted-2 pt-1 text-sm">{t("payments.subtitle")}</p>

      {/* Provider + host ---------------------------------------------------- */}
      <dl className="divide-border mt-3 divide-y text-sm">
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-2">{t("payments.provider")}</dt>
          <dd className="text-ink text-end font-bold">{status.provider}</dd>
        </div>
        {status.apiUrl && (
          <div className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-muted-2">{t("payments.apiUrl")}</dt>
            {/* dir="ltr": a URL must not be reordered, and the admin may one
                day be bilingual even though it is English-only today. */}
            <dd dir="ltr" className="text-ink min-w-0 truncate text-end font-mono text-xs">
              {status.apiUrl}
            </dd>
          </div>
        )}
      </dl>

      {/* Credentials -------------------------------------------------------- */}
      {!status.isMock && (
        <ul className="divide-border mt-1 divide-y">
          {status.credentials.map((credential) => (
            <li
              key={credential.name}
              className="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span dir="ltr" className="text-muted-2 min-w-0 truncate font-mono text-xs">
                {credential.name}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {credential.hint && (
                  // The last four characters only — enough to confirm WHICH
                  // value is installed after a rotation, not enough to be one.
                  <span dir="ltr" className="text-muted-2 font-mono text-xs">
                    ····{credential.hint}
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-pill border px-2 py-0.5 text-xs font-bold",
                    credential.configured
                      ? "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]"
                      : "bg-[#fdeceb] text-[#b3261e] border-[#f5c2be]",
                  )}
                >
                  {credential.configured
                    ? t("payments.set")
                    : t("payments.missing")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Webhook URL -------------------------------------------------------- */}
      {status.webhookUrl && !status.isMock && (
        <div className="border-border mt-3 border-t pt-3">
          <p className="text-muted-2 text-xs font-bold uppercase">
            {t("payments.webhookUrl")}
          </p>
          <p
            dir="ltr"
            className="text-ink mt-1 font-mono text-xs break-all"
          >
            {status.webhookUrl}
          </p>
          <p className="text-muted-2 pt-1 text-xs">
            {t("payments.webhookHint")}
          </p>
        </div>
      )}

      {/* Warnings ----------------------------------------------------------- */}
      {status.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {status.warnings.map((warning) => (
            <li
              key={warning}
              className="rounded-input bg-[#fff7ed] px-3 py-2 text-sm text-[#92400e]"
            >
              {warning}
            </li>
          ))}
        </ul>
      )}

      {/* Test --------------------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => runTest(false)}
          disabled={testing || !status.ready}
          className={cn(
            "rounded-pill min-h-11 px-4 text-sm font-bold",
            "bg-[#097182] text-white disabled:opacity-45",
          )}
        >
          {testing ? t("payments.testing") : t("payments.test")}
        </button>
        <span className="text-muted-2 text-xs">
          {isProduction
            ? t("payments.testHintProduction")
            : t("payments.testHint")}
        </span>
      </div>

      {result && (
        <div
          // role="status" rather than "alert": this is the outcome of something
          // the user just asked for, not an interruption.
          role="status"
          className={cn(
            "rounded-input mt-3 px-3 py-2 text-sm",
            result.ok
              ? "bg-[#ecfdf5] text-[#065f46]"
              : "bg-[#fdeceb] text-[#b3261e]",
          )}
        >
          <p className="font-semibold">{result.message}</p>
          {result.providerRef && (
            <p dir="ltr" className="pt-1 font-mono text-xs opacity-80">
              {result.providerRef}
            </p>
          )}
        </div>
      )}

      <ConfirmSheet
        open={confirmOpen}
        title={t("payments.confirmTitle")}
        body={t("payments.confirmBody")}
        confirmLabel={t("payments.confirmAction")}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void runTest(true);
        }}
      />
    </section>
  );
}
