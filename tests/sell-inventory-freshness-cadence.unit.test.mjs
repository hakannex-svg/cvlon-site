import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,
  SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC,
  SELL_INVENTORY_FRESHNESS_CADENCE_MS,
  isSellInventoryFreshnessAutomaticCheck,
  isSellInventoryFreshnessCadenceOutcome,
  isSellInventoryFreshnessLiveCheck,
  isSellInventoryFreshnessRetirableCheck,
  isSellInventoryFreshnessStandingCheck,
  sellInventoryFreshnessCadenceDecision,
  sellInventoryFreshnessCadenceOutcomes,
  sellInventoryFreshnessChecksNewestFirst,
  sellInventoryFreshnessLapsedAutomaticRun,
} from "../db/price-check/domain/sell-inventory-freshness.ts";
import { runSellInventoryFreshnessCadence } from "../lib/marketplace/sell-inventory-freshness-cadence-service.ts";

/**
 * The autonomous freshness cadence — the parts that are decidable without a
 * database.
 *
 * Everything that is a *stored* fact — which records a scan selects, what the
 * producing transaction writes, what two concurrent producers do to each other —
 * is proved against real Postgres in
 * `sell-inventory-freshness-cadence.integration.test.mjs`. This file covers the
 * pure rule, the closed reason vocabulary, the summary's privacy, and the
 * structural properties a running database cannot show: that the producing
 * repository contains no revoke, that the scheduled function is gated, and that
 * the manual path's behaviour is untouched.
 */

const root = path.resolve(import.meta.dirname, "..");
// Line endings are normalised because this checkout uses `core.autocrlf=true`.
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n/g, "\n");

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const cadenceRepository = read(
  "db", "price-check", "repositories", "sell-inventory-freshness-cadence-repository.ts",
);
const manualRepository = read(
  "db", "price-check", "repositories", "sell-inventory-freshness-repository.ts",
);
const cadenceService = read("lib", "marketplace", "sell-inventory-freshness-cadence-service.ts");
const requestService = read("lib", "marketplace", "sell-inventory-freshness-request-service.ts");
const scheduled = read("netlify", "functions", "process-sell-inventory-freshness-cadence.ts");
const panel = read("components", "admin", "InventoryFreshnessPanel.tsx");

const NOW = new Date("2026-08-18T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;

/** One stored check, automatic and standing unless the caller says otherwise. */
const check = (overrides = {}) => ({
  id: "IF00000000000000000000000A",
  requestedByAdminUserId: null,
  issuedAt: NOW,
  expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
  respondedAt: null,
  revokedAt: null,
  response: null,
  ...overrides,
});

/* ------------------------------------------------------------------ vocabulary */

test("the cadence ceilings are 25 records a run and two lapsed automatic asks", () => {
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX, 25);
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC, 2);
  // The service may not be talked past its own ceiling by a caller.
  assert.match(
    cadenceService,
    /Math\.min\(\s*input\.limit \?\? SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,\s*SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,\s*\)/,
  );
  // …and neither may the repository, which also refuses a fraction or a NaN
  // before binding the value into a LIMIT.
  assert.match(
    cadenceRepository,
    /Math\.max\(0, Math\.min\(requested, SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX\)\)/,
  );
  assert.match(cadenceRepository, /Number\.isFinite\(input\.limit\)\s*\n?\s*\? Math\.floor\(input\.limit as number\)/);
});

test("every outcome is a fixed category and nothing else is one", () => {
  assert.deepEqual([...sellInventoryFreshnessCadenceOutcomes], [
    "issued",
    "live_check",
    "stop_response",
    "lapsed_backoff",
    "not_due",
    "locked",
    "ineligible",
  ]);
  for (const outcome of sellInventoryFreshnessCadenceOutcomes) {
    assert.equal(isSellInventoryFreshnessCadenceOutcome(outcome), true, outcome);
    // A reason code is a code: never an id, a reference, an address or a URL.
    assert.match(outcome, /^[a-z_]+$/, outcome);
  }
  for (const rejected of [null, undefined, 7, "", "ISSUED", "sent", "emailed", {}]) {
    assert.equal(isSellInventoryFreshnessCadenceOutcome(rejected), false, String(rejected));
  }
  assert.equal(new Set(sellInventoryFreshnessCadenceOutcomes).size, sellInventoryFreshnessCadenceOutcomes.length);
});

test("automatic and standing are read from the stored columns, not from a flag", () => {
  assert.equal(isSellInventoryFreshnessAutomaticCheck({ requestedByAdminUserId: null }), true);
  assert.equal(isSellInventoryFreshnessAutomaticCheck({ requestedByAdminUserId: "AD01" }), false);
  assert.equal(isSellInventoryFreshnessStandingCheck({ respondedAt: null, revokedAt: null }), true);
  assert.equal(isSellInventoryFreshnessStandingCheck({ respondedAt: NOW, revokedAt: null }), false);
  assert.equal(isSellInventoryFreshnessStandingCheck({ respondedAt: null, revokedAt: NOW }), false);
  // Standing is the partial unique index's own predicate, expiry and all: a
  // lapsed link is dead to the seller but still holds the record's one slot.
  const lapsed = check({ expiresAt: new Date(NOW.valueOf() - DAY_MS) });
  assert.equal(isSellInventoryFreshnessStandingCheck(lapsed), true);

  // Live is narrower, and is what the producer may never touch: standing and
  // unexpired, which is the existing "awaiting seller" reading of one check.
  assert.equal(isSellInventoryFreshnessLiveCheck(check(), NOW), true);
  assert.equal(isSellInventoryFreshnessLiveCheck(lapsed, NOW), false);
  assert.equal(isSellInventoryFreshnessLiveCheck(check({ respondedAt: NOW, response: "all_available" }), NOW), false);
  assert.equal(isSellInventoryFreshnessLiveCheck(check({ revokedAt: NOW }), NOW), false);
  // Exactly at the expiry the credential is already dead, as everywhere else in
  // this workflow.
  assert.equal(isSellInventoryFreshnessLiveCheck(check({ expiresAt: NOW }), NOW), false);

  // Retirable is the intersection: holding the slot, useless to the seller.
  assert.equal(isSellInventoryFreshnessRetirableCheck(lapsed, NOW), true);
  assert.equal(isSellInventoryFreshnessRetirableCheck(check(), NOW), false, "a live link is never retirable");
  assert.equal(isSellInventoryFreshnessRetirableCheck(check({ expiresAt: NOW }), NOW), true);
  assert.equal(isSellInventoryFreshnessRetirableCheck(check({ revokedAt: NOW }), NOW), false);
  assert.equal(
    isSellInventoryFreshnessRetirableCheck(check({ respondedAt: NOW, response: "all_available" }), NOW),
    false,
  );
});

/* -------------------------------------------------------------------- ordering */

test("checks are ordered newest first, deterministically, even on a tie", () => {
  const older = check({ id: "IF01", issuedAt: new Date(NOW.valueOf() - DAY_MS) });
  const newer = check({ id: "IF02", issuedAt: NOW });
  assert.deepEqual(
    sellInventoryFreshnessChecksNewestFirst([older, newer]).map((row) => row.id),
    ["IF02", "IF01"],
  );
  assert.deepEqual(
    sellInventoryFreshnessChecksNewestFirst([newer, older]).map((row) => row.id),
    ["IF02", "IF01"],
  );
  // Same instant: the id breaks the tie, descending, as the staff projection does.
  const tieA = check({ id: "IF03", issuedAt: NOW });
  const tieB = check({ id: "IF04", issuedAt: NOW });
  assert.deepEqual(
    sellInventoryFreshnessChecksNewestFirst([tieA, tieB]).map((row) => row.id),
    ["IF04", "IF03"],
  );
  // The input array is never mutated.
  const input = [older, newer];
  sellInventoryFreshnessChecksNewestFirst(input);
  assert.deepEqual(input.map((row) => row.id), ["IF01", "IF02"]);
});

/* -------------------------------------------------------------------- cadence */

test("a record nobody has ever asked about is due immediately", () => {
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([], NOW),
    { due: true, reason: "never_checked" },
  );
});

test("the anchor is COALESCE(responded_at, issued_at) + 45 days, boundary inclusive", () => {
  const answeredAt = new Date("2026-07-01T00:00:00Z");
  const answered = [check({
    issuedAt: new Date("2026-06-25T00:00:00Z"),
    expiresAt: new Date("2026-07-09T00:00:00Z"),
    respondedAt: answeredAt,
    response: "all_available",
  })];
  const due = new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(answered, new Date(due.valueOf() - 1)),
    { due: false, reason: "not_due" },
  );
  // Exactly at the boundary the record is due, not one millisecond later.
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(answered, due),
    { due: true, reason: "cadence_elapsed" },
  );
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(answered, new Date(due.valueOf() + 1)),
    { due: true, reason: "cadence_elapsed" },
  );

  // With no answer the clock runs from the ask. A revoked check is the only
  // unanswered row that can be measured, because an unrevoked one is standing.
  const issuedAt = new Date("2026-06-25T00:00:00Z");
  const lapsedAndReplaced = [check({
    issuedAt,
    expiresAt: new Date("2026-07-09T00:00:00Z"),
    revokedAt: new Date("2026-07-10T00:00:00Z"),
  })];
  const fromAsk = new Date(issuedAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(lapsedAndReplaced, new Date(fromAsk.valueOf() - 1)),
    { due: false, reason: "not_due" },
  );
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(lapsedAndReplaced, fromAsk),
    { due: true, reason: "cadence_elapsed" },
  );
});

test("a live credential stops the cadence; an expired one does not", () => {
  // A link somebody may be about to click. Nothing on a timer takes it away.
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([check()], new Date(NOW.valueOf() + DAY_MS)),
    { due: false, reason: "live_check" },
  );
  // Right up to the last millisecond of its life.
  const lastMoment = new Date(NOW.valueOf() + FOURTEEN_DAYS_MS - 1);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([check()], lastMoment),
    { due: false, reason: "live_check" },
  );

  // Once it has expired it is a dead credential holding a slot. It does not stop
  // the cadence — but the 45 days still have to have passed.
  const expiredAt = new Date(NOW.valueOf() + FOURTEEN_DAYS_MS);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([check()], expiredAt),
    { due: false, reason: "not_due" },
    "an expired link does not make a record due early",
  );
  const due = new Date(NOW.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([check()], due),
    { due: true, reason: "cadence_elapsed" },
  );
});

test("one lapsed automatic ask still asks; two stop the cadence", () => {
  const issuedAt = new Date("2026-06-01T00:00:00Z");
  const lapsed = (id, offsetDays, overrides = {}) => check({
    id,
    issuedAt: new Date(issuedAt.valueOf() + offsetDays * DAY_MS),
    expiresAt: new Date(issuedAt.valueOf() + (offsetDays + 14) * DAY_MS),
    ...overrides,
  });
  const after = new Date("2026-12-01T00:00:00Z");

  // One lapse: the record is asked again, and the dead credential is retired to
  // make room for the ask.
  const first = lapsed("IF01", 0);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([first], after),
    { due: true, reason: "cadence_elapsed" },
  );
  assert.equal(isSellInventoryFreshnessRetirableCheck(first, after), true);

  // Two in a row: the cadence has stopped talking to itself.
  const retired = lapsed("IF01", 0, { revokedAt: new Date(issuedAt.valueOf() + 45 * DAY_MS) });
  const second = lapsed("IF02", 45);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([retired, second], after),
    { due: false, reason: "lapsed_backoff" },
  );
  assert.equal(sellInventoryFreshnessLapsedAutomaticRun([first], after), 1);
  assert.equal(sellInventoryFreshnessLapsedAutomaticRun([retired, second], after), 2);

  // The producer's own retirement must not erase the strike it just earned: a
  // lapse counts whether or not the row has since been revoked.
  assert.equal(
    sellInventoryFreshnessLapsedAutomaticRun([retired], after),
    1,
    "retiring a lapsed ask does not un-ask it",
  );

  // A lapse is only a lapse once the link has actually expired…
  assert.equal(
    sellInventoryFreshnessLapsedAutomaticRun([first], new Date(issuedAt.valueOf() + DAY_MS)),
    0,
  );
  // …and exactly at the expiry it counts, matching every other expiry test in
  // this workflow.
  assert.equal(
    sellInventoryFreshnessLapsedAutomaticRun([first], new Date(issuedAt.valueOf() + 14 * DAY_MS)),
    1,
  );
  // An answered ask is not a lapse, and ends the run.
  assert.equal(
    sellInventoryFreshnessLapsedAutomaticRun(
      [retired, lapsed("IF02", 45, { respondedAt: new Date(issuedAt.valueOf() + 46 * DAY_MS), response: "all_available" })],
      after,
    ),
    0,
  );
});

test("a staff-issued check resets the trailing automatic run", () => {
  const issuedAt = new Date("2026-06-01T00:00:00Z");
  const automatic = (id, offsetDays, overrides = {}) => check({
    id,
    issuedAt: new Date(issuedAt.valueOf() + offsetDays * DAY_MS),
    expiresAt: new Date(issuedAt.valueOf() + (offsetDays + 14) * DAY_MS),
    ...overrides,
  });
  const after = new Date("2026-12-01T00:00:00Z");
  // The state the producer itself leaves after two rounds: the first ask
  // retired when the second was written, the second still standing and expired.
  const twoLapsed = [
    automatic("IF01", 0, { revokedAt: new Date(issuedAt.valueOf() + 45 * DAY_MS) }),
    automatic("IF02", 45),
  ];
  assert.equal(sellInventoryFreshnessLapsedAutomaticRun(twoLapsed, after), 2);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(twoLapsed, after),
    { due: false, reason: "lapsed_backoff" },
  );

  // A newer staff check ends the run by existing — the run is trailing, so it
  // stops at the first check that is not an unanswered automatic lapse. Here it
  // is a live one, which is a refusal for a different reason.
  const manualLive = check({
    id: "IF03",
    requestedByAdminUserId: "AD00000000000000000000000A",
    issuedAt: new Date(after.valueOf() - DAY_MS),
    expiresAt: new Date(after.valueOf() + 13 * DAY_MS),
  });
  assert.equal(sellInventoryFreshnessLapsedAutomaticRun([...twoLapsed, manualLive], after), 0);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([...twoLapsed, manualLive], after),
    { due: false, reason: "live_check" },
    "the backoff is reset; what remains is an ordinary live credential",
  );

  // A staff check that itself lapsed unanswered also resets the run — it is not
  // an automatic ask — so the cadence resumes rather than staying stopped.
  const manualLapsed = { ...manualLive, issuedAt: new Date(issuedAt.valueOf() + 90 * DAY_MS), expiresAt: new Date(issuedAt.valueOf() + 104 * DAY_MS) };
  assert.equal(sellInventoryFreshnessLapsedAutomaticRun([...twoLapsed, manualLapsed], after), 0);
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision([...twoLapsed, manualLapsed], after),
    { due: true, reason: "cadence_elapsed" },
  );

  // …and once a staff check is answered, the ordinary cadence resumes from the
  // answer. This is the state a real reissue leaves behind: the superseded rows
  // are revoked, so none of them is standing.
  const answeredAt = new Date(issuedAt.valueOf() + 121 * DAY_MS);
  const settled = [
    twoLapsed[0],
    { ...twoLapsed[1], revokedAt: new Date(issuedAt.valueOf() + 120 * DAY_MS) },
    {
      ...manualLive,
      issuedAt: new Date(issuedAt.valueOf() + 120 * DAY_MS),
      expiresAt: new Date(issuedAt.valueOf() + 134 * DAY_MS),
      respondedAt: answeredAt,
      response: "all_available",
    },
  ];
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(settled, new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS - 1)),
    { due: false, reason: "not_due" },
  );
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(settled, new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS)),
    { due: true, reason: "cadence_elapsed" },
  );
});

test("a stop answer is sticky and no amount of time turns it back into due", () => {
  const answeredAt = new Date("2026-07-01T00:00:00Z");
  for (const response of ["some_changed", "none_available"]) {
    const stopped = [check({
      issuedAt: new Date("2026-06-25T00:00:00Z"),
      expiresAt: new Date("2026-07-09T00:00:00Z"),
      respondedAt: answeredAt,
      response,
    })];
    for (const multiplier of [0, 1, 4, 40]) {
      assert.deepEqual(
        sellInventoryFreshnessCadenceDecision(
          stopped,
          new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS * multiplier),
        ),
        { due: false, reason: "stop_response" },
        `${response} after ${multiplier} cadences`,
      );
    }
    // Only a newer check clears it, and the producer cannot write one while the
    // stop answer is newest — so the newer check is always a staff member's.
    const reissued = [
      ...stopped,
      check({
        id: "IF99",
        requestedByAdminUserId: "AD00000000000000000000000A",
        issuedAt: new Date(answeredAt.valueOf() + DAY_MS),
        expiresAt: new Date(answeredAt.valueOf() + 15 * DAY_MS),
        respondedAt: new Date(answeredAt.valueOf() + 2 * DAY_MS),
        response: "all_available",
      }),
    ];
    assert.deepEqual(
      sellInventoryFreshnessCadenceDecision(
        reissued,
        new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS * 4),
      ),
      { due: true, reason: "cadence_elapsed" },
      `${response} is cleared by a newer staff check`,
    );
  }
});

test("all_available continues on the cadence rather than stopping it", () => {
  const answeredAt = new Date("2026-07-01T00:00:00Z");
  const answered = [check({
    issuedAt: new Date("2026-06-25T00:00:00Z"),
    expiresAt: new Date("2026-07-09T00:00:00Z"),
    respondedAt: answeredAt,
    response: "all_available",
  })];
  assert.deepEqual(
    sellInventoryFreshnessCadenceDecision(answered, new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS)),
    { due: true, reason: "cadence_elapsed" },
  );
  // An unrecognised stored code is not a stop answer, and must not be treated as
  // one by accident.
  const odd = [{ ...answered[0], response: "invented_value" }];
  assert.equal(
    sellInventoryFreshnessCadenceDecision(odd, new Date(answeredAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS)).due,
    true,
  );
});

/* -------------------------------------------------------------------- summary */

test("a run summary is counts against fixed codes and carries nothing else", async () => {
  const asked = [];
  const summary = await runSellInventoryFreshnessCadence(
    null,
    { now: NOW },
    {
      selectDue: async () => [
        "SS00000000000000000000000A",
        "SS00000000000000000000000B",
        "SS00000000000000000000000C",
        "SS00000000000000000000000D",
      ],
      issue: async (_db, input) => {
        asked.push(input.sellSubmissionId);
        if (input.sellSubmissionId.endsWith("A")) {
          return { ok: true, checkId: "IF00000000000000000000000A", retiredCheckId: null };
        }
        if (input.sellSubmissionId.endsWith("D")) {
          // An ask that first retired a dead credential to free the slot.
          return { ok: true, checkId: "IF00000000000000000000000D", retiredCheckId: "IF00000000000000000000000X" };
        }
        if (input.sellSubmissionId.endsWith("B")) return { ok: false, reason: "live_check" };
        return { ok: false, reason: "locked" };
      },
    },
  );

  assert.deepEqual(Object.keys(summary).sort(), ["issued", "outcomes", "retired", "scanned"]);
  assert.equal(summary.scanned, 4);
  assert.equal(summary.issued, 2);
  assert.equal(summary.retired, 1, "retirements are counted, never named");
  assert.deepEqual(summary.outcomes, {
    issued: 2,
    live_check: 1,
    stop_response: 0,
    lapsed_backoff: 0,
    not_due: 0,
    locked: 1,
    ineligible: 0,
  });
  // Every key is an outcome code and every value is a count.
  for (const [key, value] of Object.entries(summary.outcomes)) {
    assert.equal(isSellInventoryFreshnessCadenceOutcome(key), true, key);
    assert.equal(Number.isInteger(value) && value >= 0, true, key);
  }

  // Serialised — which is what a deploy log and the HTTP body actually carry —
  // it is digits and reason codes. No id, reference, address, part, file, price,
  // location, token or URL can survive that shape.
  const serialized = JSON.stringify({ ok: true, ...summary });
  assert.match(serialized, /^[{}",:\d a-z_]+$/);
  for (const identifier of [
    ...asked, "IF00000000000000000000000A", "IF00000000000000000000000X", "@", "http", "SS-",
  ]) {
    assert.equal(serialized.includes(identifier), false, `the summary must not carry ${identifier}`);
  }
});

test("a summary with nothing to do is still a full set of zeroed counts", async () => {
  const summary = await runSellInventoryFreshnessCadence(
    null,
    { now: NOW },
    { selectDue: async () => [], issue: async () => assert.fail("nothing may be asked") },
  );
  assert.equal(summary.scanned, 0);
  assert.equal(summary.issued, 0);
  assert.equal(summary.retired, 0);
  assert.deepEqual(
    Object.keys(summary.outcomes).sort(),
    [...sellInventoryFreshnessCadenceOutcomes].sort(),
  );
  assert.equal(Object.values(summary.outcomes).every((count) => count === 0), true);
});

test("the batch ceiling is the producer's, not a caller's", async () => {
  const limits = [];
  const run = (limit) => runSellInventoryFreshnessCadence(
    null,
    { now: NOW, limit },
    {
      selectDue: async (_db, input) => { limits.push(input.limit); return []; },
      issue: async () => assert.fail("nothing may be asked"),
    },
  );
  await run(undefined);
  await run(5);
  await run(500);
  await run(SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX + 1);
  assert.deepEqual(limits, [25, 5, 25, 25]);
});

/* ------------------------------------------------------------------ producing */

test("the only row the producer ever edits is an already-expired credential", () => {
  const body = stripComments(cadenceRepository);
  // Exactly one UPDATE in the file, and it is the retirement.
  assert.deepEqual(
    [...body.matchAll(/\bupdate\s+"[a-z_]+"/gi)].map((match) => match[0].toLowerCase()),
    ['update "sell_inventory_freshness_checks"'],
  );
  // Its predicate is the safety argument, stated in SQL rather than inferred
  // from the rule above it: only an unanswered, unrevoked row that has *already
  // expired* can be matched, so a live credential cannot be revoked here even if
  // every rule above were wrong.
  assert.match(
    body,
    /update "sell_inventory_freshness_checks"\s*\n\s*set "revoked_at" = \$\{now\.toISOString\(\)\}::timestamptz,\s*\n\s*"updated_at" = \$\{now\.toISOString\(\)\}::timestamptz\s*\n\s*where "sell_submission_id" = \$\{input\.sellSubmissionId\}\s*\n\s*and "responded_at" is null\s*\n\s*and "revoked_at" is null\s*\n\s*and "expires_at" <= \$\{now\.toISOString\(\)\}::timestamptz\s*\n\s*returning "id"/,
  );
  // No builder-level update, and no delete of anything at all.
  assert.doesNotMatch(body, /\.update\(/);
  assert.doesNotMatch(body, /\.delete\(/);
  assert.doesNotMatch(body, /\bdelete\s+from/i);
  // Nothing else is written to: not the submission, not the contact, not an
  // attachment, not an evidence request, not a staff record, and not another
  // workflow's outbox row.
  for (const table of [
    "sellSubmissions", "sellSubmissionItems", "marketplaceAttachments",
    "marketplaceContacts", "marketplaceEvidenceRequests", "adminUsers",
  ]) {
    assert.doesNotMatch(body, new RegExp(`\\.(?:update|insert|delete)\\(${table}\\)`), table);
  }
  for (const table of ["sell_submissions", "marketplace_contacts", "notification_outbox"]) {
    assert.doesNotMatch(body, new RegExp(`(?:insert into|update)\\s+"${table}"`, "i"), table);
  }
  // The rows it writes, all inside one transaction.
  assert.match(body, /insert into "sell_inventory_freshness_checks"/);
  assert.match(body, /tx\.insert\(auditEvents\)/);
  assert.match(body, /\.insert\(notificationOutbox\)/);
  assert.match(body, /return db\.transaction\(async \(tx\) => \{/);
  assert.equal((body.match(/db\.transaction\(/g) ?? []).length, 1);
  // The order that makes the retirement safe: lock, then eligibility, then the
  // cadence rule, then retire, then insert.
  const lockAt = body.indexOf("for update of s skip locked");
  const eligibilityAt = body.indexOf("isSellInventoryFreshnessEligibleStatus(record.status)");
  const decisionAt = body.indexOf("sellInventoryFreshnessCadenceDecision(checks, now)");
  const retireAt = body.indexOf('update "sell_inventory_freshness_checks"');
  const insertAt = body.indexOf('insert into "sell_inventory_freshness_checks"');
  assert.ok(lockAt > 0 && lockAt < eligibilityAt, "the row is locked before eligibility is read");
  assert.ok(eligibilityAt < decisionAt, "eligibility is re-decided before the cadence rule");
  assert.ok(decisionAt < retireAt, "nothing is retired before the record is known to be due");
  assert.ok(retireAt < insertAt, "the slot is freed before the next ask is written");
});

test("a retirement is audited as the worker's, in the manual path's vocabulary", () => {
  const body = stripComments(cadenceRepository);
  assert.match(body, /action: SELL_INVENTORY_FRESHNESS_REVOKED_ACTION/);
  // The same two metadata keys the staff supersede records, and the same
  // correlation shape: ids, and nothing describing the seller or the inventory.
  assert.match(
    body,
    /sanitizedMetadata: \{\s*\n\s*inventoryFreshnessCheckId: retiredCheckId,\s*\n\s*supersededByCheckId: checkId,\s*\n\s*\}/,
  );
  // Both audit rows are the worker's, with no actor id.
  assert.equal((body.match(/actorType: "WORKER",\s*\n\s*actorId: null,/g) ?? []).length, 2);
  assert.doesNotMatch(body, /actorType: "ADMIN"/);
  // Audited only when a retirement actually happened.
  assert.match(body, /if \(retiredCheckId\) \{/);
});

test("both writers lock the same Sell Submission row, and only that row", () => {
  // The lock is what makes the two paths safe against each other. Without it,
  // both can pass their own reads and then meet at the partial unique index —
  // where the staff path, which supersedes rather than conflicting, would raise
  // a unique violation instead of doing what the staff member asked.
  const automatic = stripComments(cadenceRepository);
  const manual = stripComments(manualRepository);

  // The producer: skip a record another writer holds. It has a batch to get
  // through and will find the record again tomorrow.
  assert.match(automatic, /from "sell_submissions" s\s*\n\s*join "marketplace_contacts" c on c\."id" = s\."contact_id"\s*\n\s*where s\."id" = \$\{input\.sellSubmissionId\}\s*\n\s*for update of s skip locked/);

  // The staff path: wait for it. A staff member pressing the button meant it,
  // and superseding whatever is found on the other side of the wait is exactly
  // the intended outcome.
  assert.match(manual, /\.for\("update", \{ of: sellSubmissions \}\)/);
  assert.doesNotMatch(manual, /skipLocked|skip locked/i, "staff never skip a held record");
  assert.doesNotMatch(manual, /noWait|nowait/i);

  // Both name the submission and neither names the contact: contact
  // verification is its own workflow, and freezing it here would let a
  // freshness check block an unrelated write.
  assert.doesNotMatch(automatic, /for update of c\b/);
  assert.doesNotMatch(manual, /of: marketplaceContacts/);
  // Exactly one locking read per path, taken before anything is written.
  assert.equal((automatic.match(/for update of/g) ?? []).length, 1);
  assert.equal((manual.match(/\.for\("update"/g) ?? []).length, 1);
  const manualLockAt = manual.indexOf('.for("update"');
  assert.ok(
    manualLockAt < manual.indexOf(".update(sellInventoryFreshnessChecks)"),
    "the staff path locks before it revokes",
  );
  assert.ok(
    manualLockAt < manual.indexOf(".insert(sellInventoryFreshnessChecks)"),
    "the staff path locks before it inserts",
  );
  // The lock is inside the transaction that does the writing, not around it.
  const transactionAt = manual.indexOf("return db.transaction(async (tx) => {");
  assert.ok(transactionAt > 0 && transactionAt < manualLockAt);
});

test("concurrency is a locked row and a partial conflict target, never a caught violation", () => {
  const body = stripComments(cadenceRepository);
  // The record is held for the transaction, and a held record is skipped rather
  // than waited on.
  assert.match(body, /for update of s skip locked/);
  // The conflict target names the partial unique index by its own predicate.
  // Written as SQL rather than through the builder because this Drizzle build
  // drops `targetWhere` and emits an inferable-index specification Postgres
  // refuses outright.
  assert.match(
    body,
    /on conflict \("sell_submission_id"\)\s*\n\s*where "responded_at" is null and "revoked_at" is null\s*\n\s*do nothing/,
  );
  assert.doesNotMatch(body, /onConflictDoNothing\(\{\s*target: schema|targetWhere/);
  // A loser writes nothing: the insert takes the DO NOTHING branch and the whole
  // transaction — including any retirement — is rolled back by a private
  // sentinel rather than left half-applied.
  assert.match(body, /if \(inserted\.rows\.length === 0\) throw new SellInventoryFreshnessSlotTaken\(\);/);
  assert.match(body, /class SellInventoryFreshnessSlotTaken extends Error/);
  // Exactly one catch in the file, and it catches that sentinel — not a driver
  // error, and never a unique violation reinterpreted as ordinary flow.
  const catches = [...body.matchAll(/catch \(([a-zA-Z]+)\) \{/g)];
  assert.equal(catches.length, 1);
  assert.match(body, /if \(error instanceof SellInventoryFreshnessSlotTaken\) \{\s*\n\s*return \{ ok: false as const, reason: "live_check" as const \};\s*\n\s*\}\s*\n\s*throw error;/);
  assert.doesNotMatch(body, /23505|unique_violation|duplicate key/i);
  // The outbox row keeps the manual path's idempotency key and its target.
  assert.match(body, /idempotencyKey: `sell-inventory-freshness:\$\{checkId\}:v1`/);
  assert.match(body, /onConflictDoNothing\(\{ target: notificationOutbox\.idempotencyKey \}\)/);
});

test("an automatic check is marked by a null requester and a WORKER audit row", () => {
  const body = stripComments(cadenceRepository);
  // The check itself: `requested_by_admin_user_id` is null, written as a literal
  // rather than derived from anything a caller passed.
  const insertAt = body.indexOf('insert into "sell_inventory_freshness_checks"');
  const insert = body.slice(insertAt, body.indexOf('returning "id"', insertAt));
  assert.match(insert, /"requested_by_admin_user_id"/);
  assert.match(insert, /\$\{input\.tokenDerivationNonce\},\s*\n\s*null,/);
  assert.doesNotMatch(insert, /actor/i, "the automatic path has no actor to record");
  // The audit row: WORKER, with no actor id.
  assert.match(body, /actorType: "WORKER",\s*\n\s*actorId: null,/);
  assert.match(body, /action: SELL_INVENTORY_FRESHNESS_REQUESTED_ACTION/);
  assert.match(body, /correlationId: `sell-inventory-freshness:\$\{checkId\}`/);
  // Both audit rows carry ids and an expiry and nothing else. The retirement's
  // two keys are the manual supersede's two keys; the ask's two are the manual
  // request's two.
  const metadataBlocks = [...body.matchAll(/sanitizedMetadata: \{([\s\S]*?)\n\s*\},/g)]
    .map((match) => match[1]);
  assert.equal(metadataBlocks.length, 2, "one retirement row, one ask row");
  const [retirement, ask] = metadataBlocks;
  assert.match(retirement, /inventoryFreshnessCheckId: retiredCheckId/);
  assert.match(retirement, /supersededByCheckId: checkId/);
  assert.match(ask, /inventoryFreshnessCheckId: checkId/);
  assert.match(ask, /expiresAt: input\.expiresAt\.toISOString\(\)/);
  for (const block of metadataBlocks) {
    assert.equal(block.split("\n").filter((line) => line.trim()).length, 2, block);
    for (const forbidden of [
      "reference", "publicReference", "businessEmail", "contact", "description",
      "partNumber", "quantity", "price", "location", "token", "url", "Url", "nonce",
      "status", "response",
    ]) {
      assert.equal(block.includes(forbidden), false, `audit metadata must not carry ${forbidden}`);
    }
  }
});

test("no credential, address or identifier can leave the producing path", () => {
  for (const [name, source] of [
    ["cadence repository", cadenceRepository],
    ["cadence service", cadenceService],
  ]) {
    // The data-bearing layers never log. A scheduled function's log is read by
    // operations, which is not the set of people who may read a seller record.
    assert.doesNotMatch(source, /console\./, name);
  }
  // The function emits exactly two JSON log sites: a fixed refusal reason and
  // the service's count-only summary. No general log call or data-bearing field
  // is allowed into that operational trace.
  assert.equal((scheduled.match(/console\.info\(JSON\.stringify\(/g) ?? []).length, 2);
  assert.doesNotMatch(scheduled, /console\.(?:log|debug|warn|error)/);
  const completedLog = scheduled.slice(
    scheduled.indexOf('outcome: "completed"'),
    scheduled.indexOf("return Response.json"),
  );
  assert.doesNotMatch(completedLog, /\.\.\.summary/);
  for (const count of [
    "scanned", "issued", "retired", "live_check", "stop_response",
    "lapsed_backoff", "not_due", "locked", "ineligible",
  ]) {
    assert.match(scheduled, new RegExp(`${count}: summary\\.`));
  }
  for (const forbidden of [
    "businessEmail", "normalizedEmail", "publicReference", "keyedTokenHash",
    "tokenDerivationNonce", "recipientReference", "sellSubmissionId", "checkId",
  ]) {
    assert.equal(scheduled.includes(forbidden), false, `scheduled log surface must not name ${forbidden}`);
  }
  for (const [name, source] of [
    ["cadence repository", cadenceRepository],
    ["cadence service", cadenceService],
    ["scheduled function", scheduled],
  ]) {
    // No layer here derives, re-derives or renders a credential or a link.
    assert.doesNotMatch(source, /deriveSellInventoryFreshnessToken|sellInventoryFreshnessUrl/, name);
    assert.doesNotMatch(source, /businessEmail|normalizedEmail/, name);
    assert.doesNotMatch(source, /publicReference/, name);
  }
  // The producing repository is handed a keyed hash and a nonce, exactly as the
  // manual one is, and can therefore never hold a plaintext token.
  assert.match(cadenceRepository, /keyedTokenHash: string;\s*\n\s*tokenDerivationNonce: string;/);
  // The one place a plaintext credential exists is still the request service.
  assert.match(
    requestService,
    /const keyedTokenHash = hashSellInventoryFreshnessToken\(\s*key,\s*deriveSellInventoryFreshnessToken\(key, nonce\),\s*\);/,
  );
  assert.doesNotMatch(requestService, /console\./);
});

test("the automatic sibling shares minting and leaves the manual export alone", () => {
  // One derivation, one expiry, used by both paths.
  assert.equal(
    (requestService.match(/hashSellInventoryFreshnessToken\(/g) ?? []).length,
    1,
    "there must be exactly one place a credential is minted",
  );
  assert.match(
    requestService,
    /expiresAt: new Date\(now\.valueOf\(\) \+ SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS\)/,
  );
  assert.equal(
    (requestService.match(/SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS\)/g) ?? []).length,
    1,
    "both paths must read one TTL",
  );
  // The manual export still takes an actor and still calls the manual
  // repository; the automatic one takes none and calls the insert-only one.
  const manual = requestService.slice(
    requestService.indexOf("export async function requestSellInventoryFreshness("),
    requestService.indexOf("export type RequestAutomaticSellInventoryFreshnessDependencies"),
  );
  assert.match(manual, /actor: \{ id: string \};/);
  assert.match(manual, /actor: input\.actor,/);
  assert.match(manual, /Promise<IssueSellInventoryFreshnessCheckOutcome>/);
  const automatic = requestService.slice(
    requestService.indexOf("export async function requestAutomaticSellInventoryFreshness("),
  );
  assert.doesNotMatch(automatic, /actor/);
  assert.match(automatic, /Promise<IssueAutomaticSellInventoryFreshnessCheckOutcome>/);
  // The manual repository is unchanged by Stage 2: it still supersedes, and the
  // automatic path borrows only its audit vocabulary.
  assert.match(manualRepository, /\.update\(sellInventoryFreshnessChecks\)\s*\n\s*\.set\(\{ revokedAt: now, updatedAt: now \}\)/);
  assert.match(
    cadenceRepository,
    /import \{\s*SELL_INVENTORY_FRESHNESS_REQUESTED_ACTION,\s*SELL_INVENTORY_FRESHNESS_REVOKED_ACTION,\s*SELL_SUBMISSION_AGGREGATE_TYPE,\s*\} from "\.\/sell-inventory-freshness-repository\.ts";/,
    "the automatic path borrows the manual path's audit vocabulary and nothing else",
  );
  assert.doesNotMatch(cadenceRepository, /issueSellInventoryFreshnessCheck/);
});

/* ------------------------------------------------------------------ schedule */

test("the scheduled function has a same-morning retry, is production-only and gated on both switches", () => {
  // 13:17 and 14:17 UTC, which are 09:17 and 10:17 in New York while Eastern
  // daylight time is in force. Not 06:17 UTC, which would be the middle of a US
  // night. The second pass is harmless after success because the due/live-link
  // policy is re-checked before every write.
  assert.match(scheduled, /export const config = \{ schedule: "17 13,14 \* \* \*" \};/);
  assert.equal((scheduled.match(/schedule:/g) ?? []).length, 1);
  assert.match(scheduled, /event: "sell_inventory_freshness_cadence"/);
  assert.match(scheduled, /outcome: "completed"/);
  assert.match(scheduled, /outcome: "refused"/);
  // The existing convention: an explicit non-production context is refused, and
  // an absent one may run, because Netlify can omit CONTEXT from the published
  // deploy the schedule actually runs in.
  assert.match(scheduled, /process\.env\.CONTEXT\) && process\.env\.CONTEXT !== "production"/);
  // Both feature gates, and both must be on.
  assert.match(scheduled, /!isMarketplaceEnabled\(\) \|\| !isSellSubmissionEnabled\(\)/);
  assert.match(scheduled, /return new Response\(null, \{ status: 204 \}\);/);
  // The refusal is decided before anything is asked of the database.
  assert.ok(
    scheduled.indexOf("status: 204") < scheduled.indexOf("runSellInventoryFreshnessCadence(priceCheckDb)"),
    "the gates are decided before the producer runs",
  );
  // It produces; it does not deliver. The minute worker owns sending.
  assert.doesNotMatch(scheduled, /provider|Postmark|send\(/i);
  assert.doesNotMatch(scheduled, /processOneResultNotification|processNextNotification/);
  // netlify.toml is untouched: the schedule is declared in the function itself.
  const netlifyToml = read("netlify.toml");
  assert.doesNotMatch(netlifyToml, /freshness|availability/i);
});

test("the autonomous surface is these three files and nowhere else", () => {
  // Stage 1's manual path stays manual. Nothing in it schedules, sleeps or
  // produces on a timer — comments stripped, because several of these modules
  // discuss the cadence in prose.
  for (const [name, relative] of [
    ["domain", ["db", "price-check", "domain", "sell-inventory-freshness.ts"]],
    ["manual repository", ["db", "price-check", "repositories", "sell-inventory-freshness-repository.ts"]],
    ["request service", ["lib", "marketplace", "sell-inventory-freshness-request-service.ts"]],
    ["seller service", ["lib", "marketplace", "sell-inventory-freshness-service.ts"]],
    ["handlers", ["lib", "marketplace", "email", "sell-inventory-freshness-handlers.ts"]],
    ["public routes", ["lib", "marketplace", "sell-inventory-freshness-public-routes.ts"]],
    ["write routes", ["lib", "marketplace", "admin", "write-routes.ts"]],
    ["cadence repository", ["db", "price-check", "repositories", "sell-inventory-freshness-cadence-repository.ts"]],
    ["cadence service", ["lib", "marketplace", "sell-inventory-freshness-cadence-service.ts"]],
  ]) {
    assert.doesNotMatch(
      stripComments(read(...relative)),
      /setInterval|setTimeout|schedule\(/i,
      `${name} must not run itself`,
    );
  }
  // Exactly one file declares a schedule for this workflow, and it is the
  // scheduled function.
  const functions = fs.readdirSync(path.join(root, "netlify", "functions"));
  const scheduled = functions.filter((name) =>
    /freshness/i.test(name) && read("netlify", "functions", name).includes("export const config"));
  assert.deepEqual(scheduled, ["process-sell-inventory-freshness-cadence.ts"]);
  // The manual admin route still exists and is still the staff way in.
  assert.match(
    read("lib", "marketplace", "admin", "write-routes.ts"),
    /export function createInventoryFreshnessRequestRoute\(/,
  );
});

/* --------------------------------------------------------------------- panel */

test("the admin panel says the schedule exists and keeps every disclaimer", () => {
  const prose = panel.replace(/\s+/g, " ");
  // The Stage 1 sentence is gone.
  assert.doesNotMatch(prose, /nothing is scheduled today/);
  assert.doesNotMatch(prose, /every check is issued by hand/);
  // What replaced it says what the schedule does and what it will not do.
  assert.match(prose, /Civilon also asks on its own about every\{" "\} \{SELL_INVENTORY_FRESHNESS_CADENCE_DAYS\} days/);
  assert.match(prose, /the scheduled check runs once a day/);
  assert.match(prose, /asks at most once per submission per\{" "\} \{SELL_INVENTORY_FRESHNESS_CADENCE_DAYS\} days/);
  // What it will never do, and the two-strike stop, stated as behaviour rather
  // than as a promise about outcomes.
  assert.match(prose, /never touches a link that is still live/);
  assert.match(prose, /only clears one that has already expired before asking again/);
  assert.match(prose, /It stops after two scheduled asks in a row go unanswered/);
  assert.match(prose, /stops as soon as the seller says the inventory changed/);
  assert.match(prose, /Asking here is always available and starts the schedule over/);
  // A staff member reading "Expired" learns what the schedule will do next.
  assert.match(prose, /retire this dead link and ask once more when the cadence comes round/);
  assert.match(prose, /if that one also goes unanswered it stops until a staff member asks by hand/);
  // The one-strike wording the first cut carried is gone.
  assert.doesNotMatch(prose, /leaves this record alone while that stands/);
  assert.doesNotMatch(prose, /never replaces a link that is still outstanding/);
  // Every disclaimer the panel carried before is still carried, word for word.
  assert.match(prose, /it is not email verification, company verification, supplier approval, certification, authenticity proof, airworthiness or regulatory approval, a confirmation of availability, or any obligation for Civilon to buy/);
  assert.match(prose, /changes no status, no business review and no evidence review/);
  assert.match(prose, /It is their statement, not a Civilon confirmation/);
  assert.match(prose, /availability remains subject to confirmation/);
  assert.match(prose, /That is not a read receipt and not proof the seller opened or answered it\./);
  assert.match(prose, /Civilon will not ask again on the ordinary cadence until a staff member issues a new check\./);
  // …and the panel still renders no credential.
  for (const forbidden of ["keyedTokenHash", "tokenDerivationNonce", "token", "Url"]) {
    assert.equal(panel.includes(forbidden), false, `the panel must not mention ${forbidden}`);
  }
  // The copy never claims the schedule concludes anything. "guarantee" appears
  // in this file only inside a denial, so the claim forms are what is refused.
  assert.doesNotMatch(prose, /automatically verif|automatically confirm|automatically approv/i);
  assert.doesNotMatch(prose, /we guarantee|Civilon guarantees|is a guarantee/i);
  assert.doesNotMatch(prose, /verified supplier|approved supplier|certified/i);
});
