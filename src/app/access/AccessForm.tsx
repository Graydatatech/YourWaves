"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The passcode box.
 *
 * A Client Component for one reason: the failure has to be shown without
 * losing what was typed, and a full round-trip that re-renders an empty field
 * is how somebody concludes the password does not work.
 *
 * `next` is a PATH, validated on the server before it is used. It arrives from
 * a query parameter, which is attacker-controlled — sending somebody to
 * `?next=https://elsewhere` after they authenticate would be an open redirect
 * wearing a login page.
 */
export function AccessForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong" | "error">(
    "idle",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password === "" || state === "checking") return;
    setState("checking");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          redirectTo?: string;
        };
        // A full navigation, not a router push: the cookie was set by the
        // response and the proxy has to see it on a fresh request. A
        // client-side transition would re-enter a tree the gate has not
        // re-evaluated.
        window.location.assign(body.redirectTo || "/");
        return;
      }
      setState(response.status === 401 ? "wrong" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="mt-8" noValidate>
      <label
        htmlFor="site-password"
        className="text-ink block text-sm font-bold"
      >
        <span dir="rtl">كلمة المرور</span>
        <span dir="ltr" className="text-muted-2 ms-2 font-semibold">
          / Password
        </span>
      </label>

      <input
        id="site-password"
        type="password"
        // The browser's own password manager is a feature here: the client will
        // be typing this on a phone.
        autoComplete="current-password"
        autoFocus
        dir="ltr"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          if (state !== "idle") setState("idle");
        }}
        aria-invalid={state === "wrong" || undefined}
        aria-describedby={state === "wrong" ? "site-password-error" : undefined}
        className={cn(
          "rounded-input bg-surface mt-2 min-h-12 w-full border px-4",
          // 16px minimum, or iOS Safari zooms the viewport on focus and throws
          // the field off screen.
          "text-ink text-[16px]",
          "focus-visible:border-accent focus-visible:outline-focus",
          "focus-visible:outline-2 focus-visible:outline-offset-0",
          state === "wrong" ? "border-danger" : "border-border",
        )}
      />

      <p
        id="site-password-error"
        role="alert"
        aria-live="polite"
        className="text-danger mt-2 text-sm font-semibold empty:hidden"
      >
        {state === "wrong" ? (
          <span dir="rtl">كلمة المرور غير صحيحة. / That password is wrong.</span>
        ) : state === "error" ? (
          <span dir="rtl">
            تعذّر التحقق الآن. حاول مرة أخرى. / Could not check just now.
          </span>
        ) : (
          ""
        )}
      </p>

      <button
        type="submit"
        disabled={password === "" || state === "checking"}
        className={cn(
          "bg-brand text-ink-deep shadow-cta rounded-pill mt-5 min-h-13 w-full",
          "px-6 text-base font-bold",
          "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        )}
      >
        {state === "checking" ? (
          <span dir="rtl">جارٍ التحقق…</span>
        ) : (
          <span dir="rtl">دخول / Enter</span>
        )}
      </button>
    </form>
  );
}
