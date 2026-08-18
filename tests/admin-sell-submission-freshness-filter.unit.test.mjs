import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC,
  isSellInventoryFreshnessFilter,
  sellInventoryFreshnessFilters,
} from "../db/price-check/domain/sell-inventory-freshness.ts";

/**
 * The bulk-inventory freshness drill-down — everything about it that is
 * decidable without a database.
 *
 * What the filter actually returns is proved against real Postgres in
 * `admin-inventory-freshness-health.integration.test.mjs`. This file
 * covers what a database cannot show: that the filter vocabulary is a closed
 * allowlist, that its SQL is the producer's own predicate rather than a second
 * copy of it, that a malformed value fails closed instead of widening the list,
 * that the choice survives the review chips and the filter form, that the four
 * dashboard counters link to exactly the right URLs and Delivery concerns links
 * nowhere, and that Buy Requests and Price Check grew no freshness surface.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const domain = read("db", "price-check", "domain", "sell-inventory-freshness.ts");
const repository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const producer = read(
  "db", "price-check", "repositories", "sell-inventory-freshness-cadence-repository.ts",
);
const listView = read("components", "admin", "MarketplaceListView.tsx");
const display = read("lib", "price-check", "admin", "display.ts");
const section = read("components", "admin", "InventoryFreshnessHealth.tsx");
const sellPage = read("app", "admin", "sell-submissions", "page.tsx");
const buyPage = read("app", "admin", "buy-requests", "page.tsx");
const priceCheckPage = read("app", "admin", "price-checks", "page.tsx");
const queuePage = read("app", "admin", "queue", "page.tsx");

/** The clause builder, from its signature to the next function in the file. */
const filterFunction = (() => {
  const start = repository.indexOf("function sellSubmissionFreshnessClause(");
  const end = repository.indexOf("async function listPriceCheckRows(", start);
  assert.ok(start > 0 && end > start, "the freshness clause builder must exist");
  return repository.slice(start, end);
})();

/**
 * The same normalisation the counter's own test uses, for the same reason: one
 * rule with three callers and three sets of local names. Only the names differ,
 * so normalising exactly those — and nothing else — lets the shared predicates
 * be compared as text.
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

const normalizedFilter = normalize(filterFunction);
const normalizedProducer = normalize(producer);

/* --------------------------------------------------------- the allowlist */

test("the freshness vocabulary is exactly four states and admits nothing else", () => {
  assert.deepEqual([...sellInventoryFreshnessFilters], [
    "due",
    "live",
    "backoff",
    "seller_changes",
  ]);
  assert.equal(
    new Set(sellInventoryFreshnessFilters).size,
    sellInventoryFreshnessFilters.length,
  );
  for (const value of sellInventoryFreshnessFilters) {
    assert.equal(isSellInventoryFreshnessFilter(value), true, value);
    // A filter value is a code: never an id, a reference, an address or a URL.
    assert.match(value, /^[a-z_]+$/, value);
  }
  // Everything else is malformed — casing variants, counter keys, the fifth
  // counter, an empty string, a SQL fragment and every non-string.
  for (const rejected of [
    null, undefined, 7, {}, [], "", " ", "due ", "DUE", "Due", "dueNow", "liveLinks",
    "sellerChanges", "delivery_concerns", "deliveryConcerns", "not_due", "never_checked",
    "cadence_elapsed", "live_check", "stop_response", "lapsed_backoff", "all",
    "due'--", "1=1", "some_changed", "none_available",
  ]) {
    assert.equal(isSellInventoryFreshnessFilter(rejected), false, String(rejected));
  }
  // Delivery concerns is deliberately absent, and the domain says why.
  assert.match(domain, /Delivery concerns is deliberately absent/);
});

/* ------------------------------------------------ the rule is not duplicated */

test("the filter reuses the producer's eligibility predicate verbatim", () => {
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
    assert.ok(normalizedFilter.includes(expected), `filter: ${label}`);
  }
});

test("the filter reuses the producer's live-credential test verbatim", () => {
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
  assert.ok(normalizedFilter.includes(fragment), "filter");
  // `due` negates it exactly as the producer does; `live` reports it.
  assert.ok(normalizedProducer.includes(`and not ${fragment}`));
  assert.match(filterFunction, /const live = sql`exists \(/);
  assert.match(filterFunction, /\? sql`not \$\{live\}/);
  assert.match(filterFunction, /state === "live"\s*\?\s*live/);
});

test("the filter reuses the producer's trailing lapsed-run count verbatim", () => {
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
  assert.ok(normalizedFilter.includes(fragment), "filter");
  // Both sides of the threshold are the shared constant, never a literal two:
  // `due` is below it and `backoff` is at or above it.
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC, 2);
  assert.match(
    filterFunction,
    /and \$\{lapsed\} < \$\{SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC\}/,
  );
  assert.match(
    filterFunction,
    /sql`\$\{lapsed\} >= \$\{SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC\}`/,
  );
});

test("the filter reuses the producer's newest-check lateral and cadence anchor verbatim", () => {
  const lateral = normalize(`
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
  assert.ok(normalizedProducer.includes(lateral), "producer");
  assert.ok(normalizedFilter.includes(lateral), "filter");

  const anchor = normalize(`
    and (
      latest."id" is null
      or coalesce(latest."responded_at", latest."issued_at") <= \${THRESHOLD}::timestamptz
    )
  `);
  assert.ok(normalizedProducer.includes(anchor), "producer");
  assert.ok(normalizedFilter.includes(anchor), "filter");

  // The stop answers are the producer's, negated for `due` and reported for
  // `seller_changes`, and both come off the shared domain list.
  const notStopped = normalize(
    'and (latest."response" is null or latest."response" not in (${STOP}))',
  );
  assert.ok(normalizedProducer.includes(notStopped), "producer");
  assert.ok(normalizedFilter.includes(notStopped), "filter");
  assert.ok(normalizedFilter.includes(normalize('latest."response" in (${STOP})')));

  // The 45-day boundary is derived from the shared constant, and the filter
  // spells neither number out in executable code.
  const executable = filterFunction
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(executable, /new Date\(now\.valueOf\(\) - SELL_INVENTORY_FRESHNESS_CADENCE_MS\)/);
  assert.doesNotMatch(executable, /\b45\b/, "the filter must not spell the cadence out");
  assert.doesNotMatch(executable, /\b14\b/, "the filter must not spell the link life out");
  // Nor may it re-spell any vocabulary the domain already owns.
  for (const literal of [
    "some_changed", "none_available", "all_available", "bulk_inventory",
    "verified", "under_review", "VERIFIED",
  ]) {
    assert.doesNotMatch(
      filterFunction,
      new RegExp(`"${literal}"`),
      `the filter must not spell "${literal}" out`,
    );
  }
});

test("the filter drops the producer's batch cap and its run ordering", () => {
  // The counter is the size of the backlog and so is the list it opens: capping
  // it at a batch would read as "these are all of them".
  assert.doesNotMatch(filterFunction, /SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX/);
  assert.doesNotMatch(filterFunction, /\blimit \$\{/);
  // The one LIMIT in the statement is the newest-check lateral's own.
  assert.equal((filterFunction.match(/\blimit\b/g) ?? []).length, 1);
  assert.match(filterFunction, /order by k\."issued_at" desc, k\."id" desc\s*\n\s*limit 1/);
  // The producer's oldest-due-first run ordering is not part of what `due`
  // means, and the list keeps its own established ordering instead.
  assert.match(producer, /order by\s*\n\s*coalesce\(latest\."responded_at", latest\."issued_at"\) asc nulls first/);
  assert.doesNotMatch(filterFunction, /asc nulls first/);
  assert.doesNotMatch(filterFunction, /s\."submitted_at"/);
  assert.match(
    repository,
    /\.orderBy\(desc\(sellSubmissions\.submittedAt\), desc\(sellSubmissions\.id\)\)/,
  );
});

/* ------------------------------------------------------------- fail closed */

test("a malformed freshness value returns nothing rather than widening the list", () => {
  // Both entry points refuse it before any branch runs, exactly as they refuse a
  // malformed assignee and a malformed review state.
  assert.match(
    repository,
    /if \(filters\.freshness && !isSellInventoryFreshnessFilter\(filters\.freshness\)\) return \[\];/,
  );
  assert.match(
    repository,
    /if \(filters\.freshness && !isSellInventoryFreshnessFilter\(filters\.freshness\)\) return counts;/,
  );
  // And the clause builder itself throws rather than returning null, so a future
  // caller cannot reintroduce the widening bug by skipping the guard.
  assert.match(
    filterFunction,
    /if \(!isSellInventoryFreshnessFilter\(freshness\)\) throw new Error\("Malformed freshness filter\."\);/,
  );
  // The page hands the raw value over rather than dropping it, for the same
  // reason it hands over a raw assignee.
  assert.match(sellPage, /const rawFreshness = one\("freshness"\);/);
  assert.match(sellPage, /freshness: rawFreshness \|\| undefined,/);
  assert.doesNotMatch(sellPage, /pick<[^>]*>\("freshness"/);
});

test("the filter is read-only, like the rest of this module", () => {
  for (const forbidden of [
    /\.insert\(/, /\.update\(/, /\.delete\(/, /\.transaction\(/,
    /\binsert into\b/i, /\bupdate\s+"/i, /\bdelete from\b/i,
    /for update/i, /\bfor share\b/i, /\bskip locked\b/i,
  ]) {
    assert.doesNotMatch(filterFunction, forbidden, `the filter must not match ${forbidden}`);
  }
  assert.doesNotMatch(repository, /db\.insert|db\.update|db\.delete|\.transaction\(/);
});

test("the filter narrows the existing list and adds no projection of its own", () => {
  // It is a where-clause on the query the Sell list already runs, so no column,
  // no credential and no provider datum can reach the page through it.
  assert.match(filterFunction, /return sql`\$\{sellSubmissions\.id\} in \(/);
  for (const forbidden of [
    "keyed_token_hash", "token_derivation_nonce", "keyedTokenHash", "tokenDerivationNonce",
    "business_email", "normalized_email", "recipient_reference", "provider_message_id",
    "idempotency_key", "sanitized_failure_code", "lease_owner", "asking_unit_price",
    "object_key", "notification_outbox", "documents_summary",
  ]) {
    assert.equal(
      filterFunction.includes(forbidden),
      false,
      `the filter must not name ${forbidden}`,
    );
  }
  // The one column it projects out of the subquery is the join key it filters on.
  const projected = [...filterFunction.matchAll(/select s\."(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(projected, ["id"]);
});

/* ----------------------------------------------------- the Sell list surface */

test("the Sell list keeps the freshness choice through the chips and the form", () => {
  // Every existing filter is still preserved in a review-chip link, and the new
  // one joins them.
  for (const key of ["search", "status", "verification", "assignee", "freshness", "age", "review"]) {
    assert.match(listView, new RegExp(`params\\.set\\("${key}"`), `${key} must survive a chip`);
  }
  // Only an allowlisted value is carried forward.
  assert.match(
    listView,
    /if \(freshness && isSellInventoryFreshnessFilter\(freshness\.value\)\) params\.set\("freshness", freshness\.value\);/,
  );
  // The control is a select inside the same GET form as the other filters, so
  // applying filters submits it; the review chip stays a hidden input so a chip
  // choice survives that submit.
  const formStart = listView.indexOf('<form className="admin-filters"');
  const formEnd = listView.indexOf("</form>", formStart);
  assert.ok(formStart > 0 && formEnd > formStart);
  const form = listView.slice(formStart, formEnd);
  assert.match(form, /<select name="freshness"/);
  assert.match(form, /filters\.review && <input type="hidden" name="review"/);
  // A malformed value does not become a selected option.
  assert.match(
    form,
    /defaultValue=\{isSellInventoryFreshnessFilter\(freshness\.value\) \? freshness\.value : ""\}/,
  );
  // The options are the vocabulary itself, so the control cannot offer a value
  // the repository would refuse.
  assert.match(form, /\{sellInventoryFreshnessFilters\.map\(value =>/);
  assert.match(form, /\{sellInventoryFreshnessFilterLabels\[value\]\}/);
  assert.match(form, /<option value="">Any freshness<\/option>/);
  // Clear drops every filter, freshness included, by going to the bare path.
  assert.match(form, /<Link href=\{basePath\}>Clear<\/Link>/);
  // The Sell page is the only caller that passes it.
  assert.match(sellPage, /freshness=\{\{ value: rawFreshness \}\}/);
});

test("the four filter labels are the counter labels, so a click lands on the same word", () => {
  for (const [value, label] of [
    ["due", "Due now"],
    ["live", "Live links"],
    ["backoff", "Backoff"],
    ["seller_changes", "Seller changes"],
  ]) {
    assert.match(
      display,
      new RegExp(`^  ${value}: "${label}",$`, "m"),
      `${value} must be labelled ${label}`,
    );
    assert.ok(section.includes(`"${label}"`), `${label} must also be a counter label`);
  }
  // Keyed off the vocabulary, so a new state cannot go unlabelled.
  assert.match(
    display,
    /sellInventoryFreshnessFilterLabels: Record<SellInventoryFreshnessFilter, string>/,
  );
  // Delivery concerns is not a filter, so it has no entry in the label map.
  assert.doesNotMatch(display, /deliveryConcerns|delivery_concerns/);
  assert.equal(
    (display.match(/^ {2}\w+: "[^"]+",$/gm) ?? []).filter((line) => /^ {2}(due|live|backoff|seller_changes):/.test(line)).length,
    sellInventoryFreshnessFilters.length,
  );
});

/* ------------------------------------------------------- the dashboard links */

test("each record counter links to its own exact Sell Submissions URL", () => {
  assert.deepEqual(
    sellInventoryFreshnessFilters.map((value) => `/admin/sell-submissions?freshness=${value}`),
    [
      "/admin/sell-submissions?freshness=due",
      "/admin/sell-submissions?freshness=live",
      "/admin/sell-submissions?freshness=backoff",
      "/admin/sell-submissions?freshness=seller_changes",
    ],
  );
  assert.match(section, /const SELL_SUBMISSION_LIST_PATH = "\/admin\/sell-submissions";/);
  assert.match(section, /href=\{`\$\{SELL_SUBMISSION_LIST_PATH\}\?freshness=\$\{filter\}`\}/);
  // Each counter's filter is the one that counts the same records.
  assert.match(
    section,
    /dueNow: "due",\s*liveLinks: "live",\s*backoff: "backoff",\s*sellerChanges: "seller_changes",\s*deliveryConcerns: null,/,
  );
  // The map is keyed by the counters, so a new counter cannot silently link nowhere.
  assert.match(
    section,
    /const counterFilters: Record<\s*keyof SellInventoryFreshnessHealthCounts,\s*SellInventoryFreshnessFilter \| null\s*> = \{/,
  );
});

test("Delivery concerns is a number and not a link, and the section says why", () => {
  assert.match(section, /deliveryConcerns: null,/);
  assert.match(section, /: <strong>\{counts\[key\]\}<\/strong>/);
  assert.match(
    section,
    /It counts emails rather than records, so there is no record list to open\./,
  );
  assert.match(section, /not comparable with\s+the other four and opens nothing/);
  // Only one href shape exists in the whole section, and it is the drill-down.
  assert.deepEqual(
    [...section.matchAll(/href=\{`([^`]+)`\}/g)].map((match) => match[1]),
    ["${SELL_SUBMISSION_LIST_PATH}?freshness=${filter}"],
  );
  assert.equal((section.match(/<a\b/g) ?? []).length, 1, "one mapped native anchor renders the four record links");
  assert.doesNotMatch(section, /<Link\b|next\/link/);
  assert.doesNotMatch(section, /https?:\/\//);
  // Each link carries its own accessible name; a bare number would read as "12".
  assert.match(
    section,
    /aria-label=\{`\$\{counterLabels\[key\]\}: open \$\{counts\[key\]\} in Sell Submissions`\}/,
  );
});

/* ------------------------------------------- no Buy Request or Price Check surface */

test("Buy Requests and Price Check grow no freshness surface at all", () => {
  for (const [name, page] of [["Buy", buyPage], ["Price Check", priceCheckPage]]) {
    assert.doesNotMatch(page, /freshness/i, `${name} must not offer a freshness filter`);
  }
  // All Work still shows the counters and still has no freshness control itself.
  assert.doesNotMatch(queuePage, /name="freshness"|freshness=/);
  // The shared list view renders the control only for the caller that passes it.
  assert.match(listView, /\{freshness && <label><span>Freshness<\/span>/);
  assert.doesNotMatch(buyPage, /freshness=\{/);
  // And the repository excludes both workflows rather than inventing a state for
  // records that have no freshness cadence.
  assert.match(repository, /if \(filters\.freshness\) return null;/);
  assert.match(
    repository,
    /if \(filters\.verification \|\| filters\.review \|\| filters\.freshness\) return \[\];/,
  );
});

test("the unified queue and its existing filters are untouched", () => {
  // Every existing filter still reaches its own clause, and the freshness clause
  // is one more clause on the Sell branch rather than a second query surface.
  assert.match(repository, /const freshness = sellSubmissionFreshnessClause\(filters\.freshness\);\s*\n\s*if \(freshness\) clauses\.push\(freshness\);/);
  assert.match(repository, /export const UNIFIED_QUEUE_LIMIT = 200;/);
  assert.match(repository, /if \(filters\.assignee && !isAssigneeFilter\(filters\.assignee\)\) return \[\];/);
  assert.match(repository, /if \(filters\.review && !isInternalReviewState\(filters\.review\)\) return \[\];/);
  // The Sell page still runs the same two reads with the same filters, so the
  // review counters count within the freshness-narrowed population.
  assert.match(sellPage, /repository\.listUnifiedAdminQueue\(priceCheckDb, filters\)/);
  assert.match(sellPage, /repository\.countMarketplaceReviewStates\(priceCheckDb, filters\)/);
  // The counters on All Work are still read unfiltered.
  assert.match(queuePage, /repository\.countSellInventoryFreshnessHealth\(priceCheckDb\)/);
});
