import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { internalReviewStates } from "../db/price-check/domain/internal-review.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const listView = read("components", "admin", "MarketplaceListView.tsx");
const buyPage = read("app", "admin", "buy-requests", "page.tsx");
const sellPage = read("app", "admin", "sell-submissions", "page.tsx");

test("Buy and Sell pages allowlist review state and load exact counters", () => {
  assert.deepEqual([...internalReviewStates], ["not_reviewed", "reviewed", "concern"]);
  for (const [name, page] of [["Buy", buyPage], ["Sell", sellPage]]) {
    assert.match(page, /review: pick<InternalReviewState>\("review", internalReviewStates\)/, name);
    assert.match(page, /repository\.listUnifiedAdminQueue\(priceCheckDb, filters\)/, name);
    assert.match(page, /repository\.countMarketplaceReviewStates\(priceCheckDb, filters\)/, name);
    assert.match(page, /reviewCounts=\{reviewCounts\}/, name);
    assert.doesNotMatch(page, /NEXT_PUBLIC_|isMarketplaceEnabled|isSellSubmissionEnabled/, name);
  }
});

test("review counters are exact, grouped in SQL, and independent of the selected review", () => {
  const start = repository.indexOf("type MarketplaceReviewCountRow");
  const end = repository.indexOf("/* Record-bound detail reads ", start);
  assert.ok(start > 0 && end > start);
  const countSection = repository.slice(start, end);
  assert.match(countSection, /count\(\*\)::int/);
  assert.equal((countSection.match(/\.groupBy\(marketplaceContacts\.businessReviewState\)/g) ?? []).length, 2);
  assert.equal((countSection.match(/\{ \.\.\.filters, review: undefined \}/g) ?? []).length, 2);
  assert.doesNotMatch(countSection, /\.limit\(/);
  assert.match(countSection, /counts\.all = internalReviewStates\.reduce/);
  assert.match(repository, /if \(filters\.review && !isInternalReviewState\(filters\.review\)\) return \[\];/);
});

test("list UI keeps active filters, exposes four counter links, and shows review per row", () => {
  for (const key of ["search", "status", "verification", "assignee", "age", "review"]) {
    assert.match(listView, new RegExp(`params\\.set\\("${key}"`), `${key} must be preserved in filter links`);
  }
  for (const label of ["All", "Not reviewed", "Reviewed", "Concern"]) {
    assert.match(listView, new RegExp(`label: "${label}"`));
  }
  assert.match(listView, /aria-label=\{`\$\{title\} internal review state`\}/);
  assert.match(listView, /aria-current=\{filters\.review === option\.state \? "page" : undefined\}/);
  assert.match(listView, /filters\.review && <input type="hidden" name="review" value=\{filters\.review\} \/>/);
  assert.match(listView, /<th>Review<\/th>/);
  assert.match(listView, /<InternalReviewChip state=\{record\.businessReviewState\} \/>/);
});
