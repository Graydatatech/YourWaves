import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SITE_GATE_COOKIE,
  isRequestAllowed,
  issueGateToken,
  resetSiteOpenCache,
} from "@/lib/siteGate";

/**
 * The pre-launch gate and its admin switch (migration 0023).
 *
 * No database: the proxy never touches one. It asks /api/site-status, so the
 * status endpoint is a mocked fetch here, and what is under test is the order
 * of the checks, the 30s memo and the closed-on-error choice.
 */

type FakeRequest = Parameters<typeof isRequestAllowed>[0];

function request(
  pathname: string,
  opts: { cookie?: string; auth?: string } = {},
): FakeRequest {
  return {
    nextUrl: { pathname, origin: "https://example.test" },
    headers: {
      get: (name) =>
        name.toLowerCase() === "authorization" ? (opts.auth ?? null) : null,
    },
    cookies: {
      get: (name) =>
        name === SITE_GATE_COOKIE && opts.cookie
          ? { value: opts.cookie }
          : undefined,
    },
  };
}

function statusFetch(answer: boolean | "fail") {
  return vi.fn(async () => {
    if (answer === "fail") throw new Error("network down");
    return Response.json({ open: answer });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  resetSiteOpenCache();
  vi.stubEnv("SITE_PASSWORD", "launch-day");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("site gate", () => {
  it("lets everything through when no password is configured", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    const fetchImpl = statusFetch(false);
    expect(await isRequestAllowed(request("/en"), fetchImpl)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks a visitor while the admin switch is off", async () => {
    expect(await isRequestAllowed(request("/en"), statusFetch(false))).toBe(
      false,
    );
  });

  it("lets a visitor through once an admin opens the site", async () => {
    const fetchImpl = statusFetch(true);
    expect(await isRequestAllowed(request("/en"), fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/api/site-status",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("never asks the status endpoint for exempt paths or cookie holders", async () => {
    const fetchImpl = statusFetch(false);
    expect(await isRequestAllowed(request("/admin/settings"), fetchImpl)).toBe(
      true,
    );
    expect(
      await isRequestAllowed(request("/api/payments/webhook"), fetchImpl),
    ).toBe(true);
    expect(
      await isRequestAllowed(
        request("/en", { cookie: issueGateToken() }),
        fetchImpl,
      ),
    ).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks at most once per 30s, and follows the switch after that", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T10:00:00Z") });
    const closed = statusFetch(false);
    expect(await isRequestAllowed(request("/en"), closed)).toBe(false);
    expect(await isRequestAllowed(request("/ar"), closed)).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);

    // The admin presses the button; within the window the old answer holds…
    const opened = statusFetch(true);
    vi.advanceTimersByTime(29_000);
    expect(await isRequestAllowed(request("/en"), opened)).toBe(false);
    expect(opened).not.toHaveBeenCalled();

    // …and after it, the new one is picked up.
    vi.advanceTimersByTime(2_000);
    expect(await isRequestAllowed(request("/en"), opened)).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("stays CLOSED when the status check fails with nothing known", async () => {
    expect(await isRequestAllowed(request("/en"), statusFetch("fail"))).toBe(
      false,
    );
  });

  it("keeps the last known answer when the status check starts failing", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T10:00:00Z") });
    expect(await isRequestAllowed(request("/en"), statusFetch(true))).toBe(
      true,
    );
    vi.advanceTimersByTime(31_000);
    expect(await isRequestAllowed(request("/en"), statusFetch("fail"))).toBe(
      true,
    );
  });

  it("shares one status request across a burst of cold visitors", async () => {
    const fetchImpl = statusFetch(true);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        isRequestAllowed(request("/en"), fetchImpl),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
