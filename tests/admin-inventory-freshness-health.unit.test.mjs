import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { notificationOutbox } from "../db/price-check/schema.ts";
import {
  SELL_INVENTORY_FRESHNESS_CADENCE_DAYS,
  SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC,
  SELL_INVENTORY_FRESHNESS_TTL_DAYS,
  sellInventoryFreshnessDeliveryState,
} from "../db/price-check/domain/sell-inventory-freshness.ts";

/**
 * The staff-facing bulk-inventory freshness counters — everything about them
 * that is decidable without a database.
 *
 * What the numbers actually come out as is proved against real Postgres in
 * `admin-inventory-freshness-health.integration.test.mjs`. This file covers the
 * three things a database cannot show: that the counting predicate is the
 * producer's own rather than a second copy of it, that the projection is
 * counts-only and writes nothing, and that the page says what the numbers mean.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const producer = read(
  "db", "price-check", "repositories", "sell-inventory-freshness-cadence-repository.ts",
);
const queuePage = read("app", "admin", "queue", "page.tsx");
const section = read("components", "admin", "InventoryFreshnessHealth.tsx");
const globalCss = read("app", "globals.css");
const indexBarrel = read("db", "price-check", "repositories", "index.ts");

/** The counts function, from its signature to the end of the file's next banner. */
const countsFunction = (() => {
  const start = repository.indexOf("export async function countSellInventoryFreshnessHealth(");
  const end = repository.indexOf("/* Record-bound detail reads ", start);
  assert.ok(start > 0 && end > start, "the counts function must exist above the detail reads");
  return repository.slice(start, end);
})();

/** Its whole section, banner and type included. */
const countsSection = (() => {
  const start = repository.indexOf("/* Bulk-inventory freshness health ");
  const end = repository.indexOf("/* Record-bound detail reads ", start);
  assert.ok(start > 0 && end > start, "the section must carry its own banner");
  return repository.slice(start, end);
})();

/**
 * One rule, two callers, two sets of local names.
 *
 * The producer scans from the Sell Submission itself (`s`) and binds its instant
 * inline; the counter reads an eligibility CTE (`e`) and binds a hoisted string.
 * Normalising exactly those differences — and nothing else — lets the shared
 * predicates be compared as text, so a change to one that is not made to the
 * other fails here rather than in production six weeks later.
 */
const normalize = (source) => source
  .replace(/\$\{now\.toISOString\(\)\}/g, "${NOW}")
  .replace(/\$\{nowIso\}/g, "${NOW}")
  .replace(/\$\{cadenceThreshold\.toISOString\(\)\}/g, "${THRESHOLD}")
  .replace(/\$\{cadenceThreshold\}/g, "${THRESHOLD}")
  .replace(/\$\{statusList\}/g, "${STATUSES}")
  .replace(/\$\{freshnessStatusList\}/g, "${STATUSES}")
  .replace(/\$\{stopResponseList\}/g, "${STOP}")
  .replace(/\$\{freshnessStopResponseList\}/g, "${STOP}")
  .replace(/\$\{"VERIFIED"\}/g, "${VERIFIED}")
  .replace(/\$\{VERIFIED_CONTACT_STATE\}/g, "${VERIFIED}")
  .replace(/\b[se]\."id"/g, 'SUBMISSION."id"')
  .replace(/\s+/g, " ")
  .trim();

const normalizedCounter = normalize(countsFunction);
const normalizedProducer = normalize(producer);

/* ------------------------------------------------ the rule is not duplicated */

test("the counter reuses the producer's eligibility predicate verbatim", () => {
  for (const [label, fragment] of [
    [
      "the joined record and contact",
      'from "sell_submissions" s join "marketplace_contacts" c on c."id" = s."contact_id"',
    ],
    [
      "kind, status, confirmed contact, not deleted",
      'where s."submission_kind"::text = ${SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND}'
        + ' and s."status"::text in (${STATUSES})'
        + ' and c."verification_state"::text = ${VERIFIED}'
        + ' and c."deleted_at" is null',
    ],
  ]) {
    const expected = normalize(fragment);
    assert.ok(normalizedProducer.includes(expected), `producer: ${label}`);
    assert.ok(normalizedCounter.includes(expected), `counter: ${label}`);
  }
});

test("the counter reuses the producer's live-credential test verbatim", () => {
  const fragment = normalize(`
    exists (
      select 1
      from "sell_inventory_freshness_checks" live
      where live."sell_submission_id" = SUBMISSION."id"
        and live."responded_at" is null
        and live."revoked_at" is null
        and live."expires_at" > \${NOW}::timestamptz
    )
  `);
  assert.ok(normalizedProducer.includes(fragment), "producer");
  assert.ok(normalizedCounter.includes(fragment), "counter");
  // The producer negates it to select; the counter reports it. Same predicate.
  assert.ok(normalizedProducer.includes(`and not ${fragment}`));
  assert.ok(normalizedCounter.includes(`${fragment} as "live"`));
});

test("the counter reuses the producer's trailing lapsed-run count verbatim", () => {
  const fragment = normalize(`
    select count(*)::int
    from (
      select bool_and(
        k2."requested_by_admin_user_id" is null
        and k2."responded_at" is null
        and k2."expires_at" <= \${NOW}::timestamptz
      ) over (
        order by k2."issued_at" desc, k2."id" desc
        rows between unbounded preceding and current row
      ) as "lapsed_run"
      from "sell_inventory_freshness_checks" k2
      where k2."sell_submission_id" = SUBMISSION."id"
    ) runs
    where runs."lapsed_run"
  `);
  assert.ok(normalizedProducer.includes(fragment), "producer");
  assert.ok(normalizedCounter.includes(fragment), "counter");
});

test("the counter reuses the producer's newest-check lateral verbatim", () => {
  const fragment = normalize(`
    left join lateral (
      select
        k."id" as "id",
        k."issued_at" as "issued_at",
        k."responded_at" as "responded_at",
        k."response"::text as "response"
      from "sell_inventory_freshness_checks" k
      where k."sell_submission_id" = SUBMISSION."id"
      order by k."issued_at" desc, k."id" desc
      limit 1
    ) latest on true
  `);
  assert.ok(normalizedProducer.includes(fragment), "producer");
  assert.ok(normalizedCounter.includes(fragment), "counter");
});

test("the cadence anchor and the stop answers are the producer's, off the same constants", () => {
  // The 45-day boundary is derived from the shared constant in both files, and
  // neither writes a number in executable code. Prose comments may explain the
  // operator using the business-facing number and are deliberately ignored.
  for (const [label, source] of [["producer", producer], ["counter", countsFunction]]) {
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.match(
      executable,
      /new Date\(now\.valueOf\(\) - SELL_INVENTORY_FRESHNESS_CADENCE_MS\)/,
      label,
    );
    assert.doesNotMatch(executable, /\b45\b/, `${label} must not spell the cadence out`);
    assert.doesNotMatch(executable, /\b14\b/, `${label} must not spell the link life out`);
  }
  // The anchor itself: the answer when there is one, the ask when there is not.
  assert.ok(normalizedProducer.includes('coalesce(latest."responded_at", latest."issued_at")'));
  assert.ok(normalizedCounter.includes('coalesce(latest."responded_at", latest."issued_at")'));
  // Stop answers come from the domain list in both, never from a literal.
  assert.match(countsSection, /sellInventoryFreshnessStopResponses\.map/);
  for (const literal of ["some_changed", "none_available", "all_available", "bulk_inventory", "verified", "under_review"]) {
    assert.doesNotMatch(
      countsSection,
      new RegExp(`"${literal}"`),
      `the counter must not spell "${literal}" out`,
    );
  }
  // The two-lapse threshold is the shared constant on both sides of the section.
  assert.equal(
    (countsFunction.match(/SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC/g) ?? []).length,
    2,
    "due-now and backoff both measure against the shared threshold",
  );
});

test("the counter deliberately drops the producer's batch cap", () => {
  assert.match(producer, /limit \$\{limit\}/);
  assert.match(producer, /SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX/);
  // The counter is the size of the backlog, so it must not be capped at all.
  assert.doesNotMatch(countsSection, /SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX(?!` per run)/);
  assert.doesNotMatch(countsFunction, /SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX/);
  // The one LIMIT in the statement is the newest-check lateral's own.
  assert.equal((countsFunction.match(/\blimit\b/g) ?? []).length, 1);
  assert.match(countsFunction, /order by k\."issued_at" desc, k\."id" desc\s*\n\s*limit 1/);
});

/* ------------------------------------------------------- counts-only, no writes */

test("the counts function writes nothing and locks nothing", () => {
  for (const forbidden of [
    /\.insert\(/, /\.update\(/, /\.delete\(/, /\.transaction\(/,
    /\binsert into\b/i, /\bupdate\s+"/i, /\bdelete from\b/i,
    /for update/i, /\bfor share\b/i, /\bskip locked\b/i,
  ]) {
    assert.doesNotMatch(countsFunction, forbidden, `counts must not match ${forbidden}`);
  }
  // The whole read repository is still read-only, which is the invariant this
  // function is allowed to live inside.
  assert.doesNotMatch(repository, /db\.insert|db\.update|db\.delete|\.transaction\(/);
});

test("the projection is five integers and carries nothing else", () => {
  const start = repository.indexOf("export type SellInventoryFreshnessHealthCounts = {");
  assert.ok(start > 0, "the counts type must exist");
  const type = repository.slice(start, repository.indexOf("\n};", start));
  const fields = [...type.matchAll(/^ {2}(\w+): (\w+);$/gm)].map((match) => [match[1], match[2]]);
  assert.deepEqual(fields, [
    ["dueNow", "number"],
    ["liveLinks", "number"],
    ["backoff", "number"],
    ["sellerChanges", "number"],
    ["deliveryConcerns", "number"],
  ]);
  // Nothing in the statement selects a credential, a recipient, a provider
  // datum, an identifier or anything about the parts, the seller or the money.
  for (const forbidden of [
    "keyed_token_hash", "token_derivation_nonce", "keyedTokenHash", "tokenDerivationNonce",
    "business_email", "businessEmail", "normalized_email", "recipient_reference",
    "recipientReference", "provider_message_id", "providerMessageId", "idempotency_key",
    "idempotencyKey", "sanitized_failure_code", "sanitizedFailureCode", "lease_owner",
    "public_reference", "publicReference", "part_number", "asking_unit_price",
    "object_key", "objectKey", "company_name", "documents_summary", "template_version",
  ]) {
    assert.equal(
      countsSection.includes(forbidden),
      false,
      `the counts section must not name ${forbidden}`,
    );
  }
  // The only identifiers the statement names are join keys inside subqueries;
  // none of them is projected out. The five output columns are the whole result.
  const outputs = [...countsFunction.matchAll(
    /\bas "(due_now|live_links|backoff|seller_changes|delivery_concerns)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(outputs, [
    "due_now", "live_links", "backoff", "seller_changes", "delivery_concerns",
  ]);
});

test("the undelivered outbox states are derived from the schema enum, not written out", () => {
  assert.match(countsSection, /notificationOutbox\.state\.enumValues/);
  assert.match(countsSection, /sellInventoryFreshnessDeliveryState\(state\)/);
  assert.doesNotMatch(countsSection, /"failed"|"dead_letter"/);
  // …and the derivation still resolves to exactly the two states it must.
  const derived = notificationOutbox.state.enumValues.filter((state) => {
    const delivery = sellInventoryFreshnessDeliveryState(state);
    return delivery === "retrying" || delivery === "undeliverable";
  });
  assert.deepEqual(derived, ["failed", "dead_letter"]);
  // The outbox is filtered to this workflow's own messages by both coordinates.
  assert.match(countsFunction, /o\."message_type" = \$\{SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE\}/);
  assert.match(countsFunction, /o\."aggregate_type" = \$\{SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE\}/);
});

test("the repository still reads the outbox for delivery state only", () => {
  // The existing column-level rule, re-asserted here because this section adds
  // the first raw-SQL read of that table in this file.
  const rawOutboxColumns = [...countsFunction.matchAll(/o\."(\w+)"/g)].map((match) => match[1]);
  assert.ok(rawOutboxColumns.length > 0);
  for (const column of new Set(rawOutboxColumns)) {
    assert.ok(
      ["message_type", "aggregate_type", "state"].includes(column),
      `notification_outbox."${column}" is not a delivery-state column or a routing key`,
    );
  }
});

test("the counts function is re-exported through the established barrel", () => {
  assert.match(indexBarrel, /export \* from "\.\/marketplace-admin-repository\.ts";/);
});

/* -------------------------------------------------------------- page wiring */

test("All Work loads the freshness counters unfiltered, inside its fail-closed try", () => {
  assert.match(queuePage, /repository\.countSellInventoryFreshnessHealth\(priceCheckDb\)/);
  // Unfiltered on purpose: the cadence is a property of the workflow, not of
  // whatever the reader narrowed the table to.
  assert.doesNotMatch(queuePage, /countSellInventoryFreshnessHealth\(priceCheckDb, filters\)/);
  const tryStart = queuePage.indexOf("  try {");
  const catchStart = queuePage.indexOf("  } catch {");
  assert.ok(tryStart > 0 && catchStart > tryStart);
  const guarded = queuePage.slice(tryStart, catchStart);
  assert.match(guarded, /countSellInventoryFreshnessHealth/);
  assert.match(queuePage, /\} catch \{\s*return <AdminAccessDenied unavailable \/>;/);
  // The access gate and the no-cache directive are unchanged.
  assert.match(queuePage, /redirect\("\/admin\/login"\)/);
  assert.match(queuePage, /redirect\("\/admin\/access-denied"\)/);
  assert.match(queuePage, /if \(access\.status !== "authorized"\) return <AdminAccessDenied unavailable \/>/);
  assert.match(queuePage, /export const dynamic = "force-dynamic"/);
});

test("the section renders between the Concerns alert and the filters, and Concerns is untouched", () => {
  const concerns = queuePage.indexOf("admin-concerns-alert");
  const freshness = queuePage.indexOf("<InventoryFreshnessHealth counts={freshnessHealth} />");
  const filters = queuePage.indexOf('className="admin-filters"');
  assert.ok(concerns > 0 && freshness > concerns && filters > freshness);
  // The existing alert keeps its counters, its links and its copy.
  assert.match(queuePage, /const concernTotal = buyReviewCounts\.concern \+ sellReviewCounts\.concern/);
  assert.match(queuePage, /href="\/admin\/buy-requests\?review=concern"/);
  assert.match(queuePage, /href="\/admin\/sell-submissions\?review=concern"/);
  assert.match(queuePage, /Business-review flags needing staff follow-up\. This is not certification or an airworthiness decision\./);
  // The unified queue itself is unchanged: same call, same limit copy.
  assert.match(queuePage, /repository\.listUnifiedAdminQueue\(priceCheckDb, filters\)/);
  assert.match(queuePage, /shows up to the first \{UNIFIED_QUEUE_LIMIT\} records/);
});

/* ------------------------------------------------------------------ the copy */

test("the section states the cadence, the link life and the pause from the shared constants", () => {
  assert.match(section, /SELL_INVENTORY_FRESHNESS_CADENCE_DAYS/);
  assert.match(section, /SELL_INVENTORY_FRESHNESS_TTL_DAYS/);
  assert.match(section, /SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC/);
  // No number in the copy may be a second spelling of one of those constants.
  assert.doesNotMatch(section, /\b45 days\b/);
  assert.doesNotMatch(section, /\b14 days\b/);
  assert.doesNotMatch(section, /\btwo unanswered\b/);
  // The constants are what the copy claims they are.
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_DAYS, 45);
  assert.equal(SELL_INVENTORY_FRESHNESS_TTL_DAYS, 14);
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC, 2);
  assert.match(section, /still\s+available every \{SELL_INVENTORY_FRESHNESS_CADENCE_DAYS\} days/);
  assert.match(section, /link lasts \{SELL_INVENTORY_FRESHNESS_TTL_DAYS\} days/);
  assert.match(section, /pauses for a record after\{" "\}\s*\{SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC\} unanswered asks/);
});

test("the section says a seller's answer is a statement and nothing Civilon certifies", () => {
  assert.match(section, /that seller&rsquo;s own\s+own stock at that moment|own statement about their\s+own stock at that moment/);
  assert.match(section, /not Civilon certification/);
  assert.match(section, /not an\s+airworthiness approval/);
  assert.match(section, /not an authenticity guarantee/);
  assert.match(section, /not a guarantee\s+of fitness for any use/);
  assert.match(section, /availability remains subject to confirmation/);
  // Nothing here may claim Civilon concluded anything about the parts.
  assert.doesNotMatch(section, /Civilon (certifies|guarantees|approves|confirms that)/i);
  assert.doesNotMatch(section, /airworthy|authentic parts|fit for/i);
});

test("the five labels are the agreed ones and the counting choice is stated", () => {
  for (const label of ["Due now", "Live links", "Backoff", "Seller changes", "Delivery concerns"]) {
    assert.ok(section.includes(`"${label}"`), `${label} must be a counter label`);
  }
  assert.match(section, /const counterOrder = \[\s*"dueNow",\s*"liveLinks",\s*"backoff",\s*"sellerChanges",\s*"deliveryConcerns",\s*\] as const/);
  // The two populations, said plainly, because they are not comparable.
  assert.match(section, /each count bulk-inventory\s+Sell Submissions/);
  assert.match(section, /no record is counted twice/);
  assert.match(section, /Delivery concerns counts queued emails instead, so it is not comparable with\s+the other four/);
  assert.match(section, /appears in none of them/);
});

test("the four record counters use reliable native links and Delivery concerns does not", () => {
  // Exactly four links, and each one is a Sell Submission freshness drill-down.
  const hrefs = [...section.matchAll(/href=\{`([^`]+)`\}/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ["${SELL_SUBMISSION_LIST_PATH}?freshness=${filter}"]);
  assert.match(section, /const SELL_SUBMISSION_LIST_PATH = "\/admin\/sell-submissions";/);
  assert.match(section, /dueNow: "due",\s*liveLinks: "live",\s*backoff: "backoff",\s*sellerChanges: "seller_changes",\s*deliveryConcerns: null,/);
  // Delivery concerns counts messages, so it renders a bare number and the copy
  // says why rather than leaving a staff member hunting for a link.
  assert.match(section, /: <strong>\{counts\[key\]\}<\/strong>/);
  assert.match(section, /It counts emails rather than records, so there is no record list to open\./);
  assert.match(section, /opens nothing/);
  // The section links to that one list and nowhere else — no detail route, no
  // Buy Request, no Price Check, no external destination.
  assert.match(section, /<a\s+href=\{`\$\{SELL_SUBMISSION_LIST_PATH\}\?freshness=\$\{filter\}`\}/);
  assert.doesNotMatch(section, /<Link\b|next\/link/);
  assert.doesNotMatch(section, /https?:\/\//);
  assert.doesNotMatch(section, /buy-requests|price-checks|queue\?/);
  // All Work itself still grew no freshness control of its own.
  assert.doesNotMatch(queuePage, /name="freshness"|freshness=|\?due=/);
});

test("the section is a server component and reaches no database of its own", () => {
  assert.doesNotMatch(section, /"use client"/);
  assert.doesNotMatch(section, /useState|useRouter|fetch\(/);
  assert.doesNotMatch(section, /priceCheckDb|drizzle|process\.env/);
  // It receives the finished counts and only the finished counts.
  assert.match(section, /import type \{ SellInventoryFreshnessHealthCounts \}/);
  assert.match(section, /\{ counts \}: \{ counts: SellInventoryFreshnessHealthCounts \}/);
});

test("no analytics is emitted from the new surface", () => {
  for (const source of [section, queuePage, countsSection]) {
    assert.doesNotMatch(source, /trackCivilonEvent|dataLayer|civilonAnalytics/);
  }
});

/* --------------------------------------------------------------- accessibility */

test("the section is a labelled region with a definition list", () => {
  assert.match(section, /<aside\b[\s\S]*?aria-labelledby="inventory-freshness-health-heading"/);
  assert.match(section, /<h2 id="inventory-freshness-health-heading">Inventory freshness<\/h2>/);
  assert.match(section, /<dl aria-label="Inventory freshness counters">/);
  assert.match(section, /<dt>\{counterLabels\[key\]\}<\/dt>/);
  // The number is still the term's definition and the sentence still follows it;
  // four of the five wrap the number in a link with its own accessible name, so
  // "12" in a link list reads as "Backoff: open 12 in Sell Submissions".
  assert.match(section, /<strong>\{counts\[key\]\}<\/strong>\s*\}<span>\{counterDetails\[key\]\}<\/span><\/dd>/);
  assert.match(
    section,
    /aria-label=\{`\$\{counterLabels\[key\]\}: open \$\{counts\[key\]\} in Sell Submissions`\}/,
  );
});

/* --------------------------------------------------------------------- styles */

test("the section has compact responsive styles in the admin design system", () => {
  for (const rule of [
    ".admin-freshness-health{",
    ".admin-freshness-health.needs-attention{",
    ".admin-freshness-health-intro>span{",
    ".admin-freshness-health h2{",
    ".admin-freshness-health dl{",
    ".admin-freshness-health dt{",
    ".admin-freshness-health dd strong{",
    ".admin-freshness-health-scope{",
  ]) {
    assert.ok(globalCss.includes(rule), `${rule} must exist in globals.css`);
  }
  // Every class the component sets is styled, counters included.
  for (const key of ["dueNow", "liveLinks", "backoff", "sellerChanges", "deliveryConcerns"]) {
    assert.ok(section.includes(`counter-${key}`) || section.includes("counter-${key}"), key);
  }
  assert.ok(globalCss.includes(".admin-freshness-health .counter-backoff"));
  // It collapses rather than scrolling, on the same breakpoints the admin
  // surface already uses.
  assert.ok(globalCss.includes("@media(max-width:1000px){.admin-freshness-health dl{grid-template-columns:repeat(2,minmax(0,1fr))}}"));
  assert.ok(globalCss.includes("@media(max-width:700px){.admin-freshness-health{padding:13px 14px}.admin-freshness-health dl{grid-template-columns:1fr}}"));
  // The existing Concerns alert styles are untouched.
  assert.ok(globalCss.includes(".admin-concerns-alert{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 0 16px"));
});
