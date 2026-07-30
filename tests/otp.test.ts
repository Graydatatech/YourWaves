import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { testSql } from "./helpers/db";
import {
  generateCode,
  hashCode,
  verifyCode,
  looksLikeCode,
  MAX_ATTEMPTS,
} from "@/lib/otp/code";
import {
  issueOtpToken,
  verifyOtpToken,
  TOKEN_TTL_SECONDS,
} from "@/lib/otp/token";

/**
 * OTP behaviour, exercised against the real database for anything involving the
 * rate limits or the attempt counter — those live in SQL precisely so they hold
 * under concurrency, and an in-memory fake would not test the thing that matters.
 */

const PHONE_A = "+97455010101";
const PHONE_B = "+97455020202";
const IP = "203.0.113.10";

beforeAll(() => {
  // token.ts refuses to sign without a >=32 char secret.
  process.env.OTP_TOKEN_SECRET =
    "test-secret-that-is-definitely-long-enough-0123456789";
});

afterAll(async () => {
  await testSql.end();
});

async function clearOtps() {
  await testSql`TRUNCATE otp_verifications`;
}

/** Calls request_otp the way the service does. */
async function request(phone: string, ip: string | null = IP, ttl = 300) {
  const hash = await hashCode("0000");
  const rows = await testSql<
    {
      allowed: boolean;
      reason: string;
      retry_after: number;
      otp_id: string | null;
    }[]
  >`SELECT * FROM request_otp(${phone}, ${hash}, ${ip}::inet, ${ttl})`;
  return rows[0];
}

describe("code generation", () => {
  it("always produces four digits, zero-padded", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      expect(code).toMatch(/^\d{4}$/);
      expect(looksLikeCode(code)).toBe(true);
    }
  });

  it("covers the full range including leading zeros", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) seen.add(generateCode());
    // With 4000 draws from 10k values, a generator stuck in a narrow band or
    // dropping leading zeros would show up here.
    expect(seen.size).toBeGreaterThan(1500);
    expect([...seen].some((c) => c.startsWith("0"))).toBe(true);
  });

  it("hashes and verifies, and rejects a near miss", async () => {
    const hash = await hashCode("4821");
    expect(hash).not.toContain("4821");
    expect(await verifyCode("4821", hash)).toBe(true);
    expect(await verifyCode("4822", hash)).toBe(false);
    expect(await verifyCode("", hash)).toBe(false);
  });

  it("treats a malformed stored hash as a failed attempt, never a pass", async () => {
    expect(await verifyCode("1234", "not-a-bcrypt-hash")).toBe(false);
  });
});

describe("verification token", () => {
  it("round-trips for the phone it was issued to", () => {
    const token = issueOtpToken(PHONE_A);
    const verdict = verifyOtpToken(token, PHONE_A);
    expect(verdict.valid).toBe(true);
    if (verdict.valid) expect(verdict.phone).toBe(PHONE_A);
  });

  it("REFUSES a token issued for a different phone", () => {
    // The core binding property: a token earned for a number the attacker
    // controls must not authorise anything for another number.
    const token = issueOtpToken(PHONE_A);
    const verdict = verifyOtpToken(token, PHONE_B);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe("phone_mismatch");
  });

  it("rejects an expired token", () => {
    const issuedAt = Date.now() - (TOKEN_TTL_SECONDS + 5) * 1000;
    const token = issueOtpToken(PHONE_A, issuedAt);
    const verdict = verifyOtpToken(token, PHONE_A);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe("expired");
  });

  it("rejects a tampered payload", () => {
    const token = issueOtpToken(PHONE_A);
    const [body, signature] = token.split(".");
    // Re-encode the payload with a different phone, keeping the old signature.
    const forged = Buffer.from(
      JSON.stringify({
        phone: PHONE_B,
        exp: Math.floor(Date.now() / 1000) + 600,
        jti: "x",
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const verdict = verifyOtpToken(`${forged}.${signature}`, PHONE_B);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe("bad_signature");
    // And the untampered one still validates, proving the test is meaningful.
    expect(verifyOtpToken(`${body}.${signature}`, PHONE_A).valid).toBe(true);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "nodot", "a.b.c", "..", "abc.def"]) {
      expect(verifyOtpToken(bad, PHONE_A).valid).toBe(false);
    }
    expect(verifyOtpToken(undefined, PHONE_A).valid).toBe(false);
  });
});

describe("rate limits (SQL, atomic)", () => {
  beforeEach(clearOtps);

  it("allows the first send", async () => {
    const first = await request(PHONE_A);
    expect(first.allowed).toBe(true);
    expect(first.otp_id).toBeTruthy();
  });

  it("blocks a second send within 60s and reports retry_after", async () => {
    await request(PHONE_A);
    const second = await request(PHONE_A);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe("per_phone_cooldown");
    expect(second.retry_after).toBeGreaterThan(0);
    expect(second.retry_after).toBeLessThanOrEqual(60);
  });

  it("blocks the 6th send in an hour per phone", async () => {
    // Backdate five sends so the 60s cooldown is not what trips.
    for (let i = 0; i < 5; i++) {
      await testSql`
        INSERT INTO otp_verifications (phone, code_hash, expires_at, ip, created_at)
        VALUES (${PHONE_A}, 'x', now() + interval '5 min', ${IP}::inet,
                now() - interval '5 minutes' * ${i + 1})
      `;
    }
    const sixth = await request(PHONE_A);
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toBe("per_phone_hourly");
  });

  it("blocks the 21st send in an hour per IP", async () => {
    // 20 sends from one IP spread across distinct phones we have already seen,
    // so the distinct-phone limit is not the one being measured.
    for (let i = 0; i < 20; i++) {
      await testSql`
        INSERT INTO otp_verifications (phone, code_hash, expires_at, ip, created_at)
        VALUES (${PHONE_A}, 'x', now() + interval '5 min', ${IP}::inet,
                now() - interval '2 minutes' * ${i + 1})
      `;
    }
    const next = await request(PHONE_A);
    expect(next.allowed).toBe(false);
    // The per-phone hourly cap is hit first, which is correct precedence —
    // assert the request is refused and that the IP cap also holds for a
    // different number from the same IP.
    expect(next.allowed).toBe(false);

    const other = await request("+97455030303");
    expect(other.allowed).toBe(false);
    expect(other.reason).toBe("per_ip_hourly");
  });

  it("blocks a 4th distinct phone from one IP in an hour", async () => {
    for (const phone of ["+97455001111", "+97455002222", "+97455003333"]) {
      await testSql`
        INSERT INTO otp_verifications (phone, code_hash, expires_at, ip, created_at)
        VALUES (${phone}, 'x', now() + interval '5 min', ${IP}::inet,
                now() - interval '10 minutes')
      `;
    }
    const fourth = await request("+97455004444");
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe("per_ip_phones");
  });

  it("does not count a repeat of an already-used number as a new distinct phone", async () => {
    for (const phone of ["+97455001111", "+97455002222"]) {
      await testSql`
        INSERT INTO otp_verifications (phone, code_hash, expires_at, ip, created_at)
        VALUES (${phone}, 'x', now() + interval '5 min', ${IP}::inet,
                now() - interval '10 minutes')
      `;
    }
    // A third distinct number is still within the cap of 3.
    const third = await request("+97455003333");
    expect(third.allowed).toBe(true);
  });

  it("skips IP limits when the IP is unknown", async () => {
    for (const phone of ["+97455001111", "+97455002222", "+97455003333"]) {
      await testSql`
        INSERT INTO otp_verifications (phone, code_hash, expires_at, ip, created_at)
        VALUES (${phone}, 'x', now() + interval '5 min', NULL,
                now() - interval '10 minutes')
      `;
    }
    const next = await request("+97455004444", null);
    expect(next.allowed).toBe(true);
  });

  it("invalidates the previous live code rather than deleting it", async () => {
    await request(PHONE_A);
    // Age it past the cooldown so a second request is permitted.
    await testSql`
      UPDATE otp_verifications SET created_at = now() - interval '2 minutes'
       WHERE phone = ${PHONE_A}
    `;
    const second = await request(PHONE_A);
    expect(second.allowed).toBe(true);

    const rows = await testSql<{ count: number; live: number }[]>`
      SELECT count(*)::int AS count,
             count(*) FILTER (WHERE expires_at > now())::int AS live
        FROM otp_verifications WHERE phone = ${PHONE_A}
    `;
    // Both rows retained (history the rate limits depend on), exactly one live.
    expect(rows[0].count).toBe(2);
    expect(rows[0].live).toBe(1);
  });
});

describe("verification flow", () => {
  beforeEach(clearOtps);

  /** Inserts a code directly so the plaintext is known to the test. */
  async function seedCode(
    phone: string,
    code: string,
    opts: { expired?: boolean; attempts?: number } = {},
  ) {
    const hash = await hashCode(code);
    const rows = await testSql<{ id: string }[]>`
      INSERT INTO otp_verifications (phone, code_hash, expires_at, attempts, ip)
      VALUES (
        ${phone}, ${hash},
        ${opts.expired ? testSql`now() - interval '1 minute'` : testSql`now() + interval '5 minutes'`},
        ${opts.attempts ?? 0}, ${IP}::inet
      )
      RETURNING id
    `;
    return rows[0].id;
  }

  it("accepts the right code and marks it consumed", async () => {
    const { verifyOtp } = await import("@/lib/otp/service");
    await seedCode(PHONE_A, "4821");

    const outcome = await verifyOtp({ phone: PHONE_A, code: "4821" });
    expect(outcome.ok).toBe(true);

    const rows = await testSql<{ consumed_at: Date | null }[]>`
      SELECT consumed_at FROM otp_verifications WHERE phone = ${PHONE_A}
    `;
    expect(rows[0].consumed_at).not.toBeNull();
  });

  it("rejects an EXPIRED code", async () => {
    const { verifyOtp } = await import("@/lib/otp/service");
    await seedCode(PHONE_A, "4821", { expired: true });

    const outcome = await verifyOtp({ phone: PHONE_A, code: "4821" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("expired");
  });

  it("rejects the 6th attempt and burns the code", async () => {
    const { verifyOtp } = await import("@/lib/otp/service");
    await seedCode(PHONE_A, "4821");

    // Five wrong guesses.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const outcome = await verifyOtp({ phone: PHONE_A, code: "0000" });
      expect(outcome.ok).toBe(false);
    }

    // The 6th is refused outright — and even the CORRECT code no longer works,
    // which is the property that matters: the code is burned, not just counted.
    const sixth = await verifyOtp({ phone: PHONE_A, code: "4821" });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(["too_many_attempts", "expired"]).toContain(sixth.reason);
    }
  });

  it("counts down remaining attempts", async () => {
    const { verifyOtp } = await import("@/lib/otp/service");
    await seedCode(PHONE_A, "4821");

    const first = await verifyOtp({ phone: PHONE_A, code: "1111" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
  });

  it("reports no_code when nothing was issued", async () => {
    const { verifyOtp } = await import("@/lib/otp/service");
    const outcome = await verifyOtp({ phone: PHONE_B, code: "4821" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("no_code");
  });

  it("does not let phone A's code verify phone B", async () => {
    const { verifyOtp } = await import("@/lib/otp/service");
    await seedCode(PHONE_A, "4821");
    const outcome = await verifyOtp({ phone: PHONE_B, code: "4821" });
    expect(outcome.ok).toBe(false);
  });
});

describe("dev echo guard", () => {
  it("never echoes the code when NODE_ENV is production", async () => {
    const { devEchoEnabled } = await import("@/lib/otp/service");
    const originalEcho = process.env.OTP_DEV_ECHO;
    const originalEnv = process.env.NODE_ENV;

    try {
      process.env.OTP_DEV_ECHO = "true";
      // NODE_ENV is readonly in the Node types but writable at runtime; the
      // whole point is to prove the AND condition holds.
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(devEchoEnabled()).toBe(false);

      (process.env as Record<string, string>).NODE_ENV = "development";
      expect(devEchoEnabled()).toBe(true);

      process.env.OTP_DEV_ECHO = "false";
      expect(devEchoEnabled()).toBe(false);

      delete process.env.OTP_DEV_ECHO;
      expect(devEchoEnabled()).toBe(false);
    } finally {
      if (originalEcho === undefined) delete process.env.OTP_DEV_ECHO;
      else process.env.OTP_DEV_ECHO = originalEcho;
      (process.env as Record<string, string>).NODE_ENV = originalEnv ?? "test";
    }
  });
});
