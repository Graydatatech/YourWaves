/**
 * Acceptance loop for SRS 3.2: run the 50-parallel hold test N times in a row
 * and fail on the first deviation.
 *
 * A single green run of a concurrency test proves very little — races are
 * probabilistic and the interleaving that breaks a design may occur once in
 * twenty. This exists so "it passes" means "it passed 20 times".
 *
 *   node scripts/holds-soak.mjs [runs]
 */
import "./load-env.mjs";
import postgres from "postgres";

const RUNS = Number(process.argv[2] ?? 20);
const PARALLEL = 50;

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url || !/_test/.test(url)) {
  console.error("Refusing to soak-test a non-_test database.");
  process.exit(1);
}

const pool = postgres(url, {
  max: PARALLEL + 10,
  ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : "require",
  onnotice: () => {},
});

let failures = 0;
const timings = [];

for (let run = 1; run <= RUNS; run++) {
  await pool`TRUNCATE bookings, booking_events, payments, blackout_dates CASCADE`;

  // A different date each run so nothing carries over — and inside
  // settings.max_advance_days (120), or every attempt is legitimately refused
  // with DATE_OUT_OF_RANGE. Reading 200 days ahead is how the first version of
  // this script "failed" 20/20 while the function was perfectly correct.
  const date = new Date(Date.now() + (30 + run) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: PARALLEL }, (_, i) =>
      pool`
        SELECT error_code FROM create_booking_hold(
          ${date}::date, '09:00'::time,
          ${"Racer " + i},
          ${"+9745500" + String(i + 1).padStart(4, "0")},
          ${"Villa " + i + ", Street 850"}
        )
      `.then((r) => r[0].error_code),
    ),
  );
  const elapsed = Date.now() - started;
  timings.push(elapsed);

  const won = results.filter((c) => c === null).length;
  const taken = results.filter((c) => c === "DATE_TAKEN").length;
  const odd = results.filter((c) => c !== null && c !== "DATE_TAKEN");

  const [{ count }] = await pool`
    SELECT count(*)::int AS count FROM bookings
     WHERE booking_date = ${date}::date AND status = 'holding'
  `;

  const ok =
    won === 1 && taken === PARALLEL - 1 && odd.length === 0 && count === 1;
  if (!ok) failures++;

  console.log(
    `run ${String(run).padStart(2)}/${RUNS}  ` +
      `${ok ? "PASS" : "FAIL"}  won=${won} taken=${taken} rows=${count} ` +
      `${odd.length ? "odd=" + JSON.stringify(odd) : ""}  ${elapsed}ms`,
  );
}

await pool.end();

const avg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
console.log(
  `\n${RUNS - failures}/${RUNS} runs passed  ` +
    `(${PARALLEL} parallel each, avg ${avg}ms, max ${Math.max(...timings)}ms)`,
);
if (failures) process.exit(1);
console.log("✓ Exactly one winner every run.");
