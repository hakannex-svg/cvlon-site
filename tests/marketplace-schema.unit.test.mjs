import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../db/price-check/schema.ts";

const dialect = new PgDialect();

function table(pgTable) {
  const config = getTableConfig(pgTable);
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name),
    column: (name) => config.columns.find((column) => column.name === name),
    checks: Object.fromEntries(
      config.checks.map((entry) => [
        entry.name,
        // Drizzle renders fully-qualified "table"."column"; drop the table
        // qualifier so the assertions below read as plain column predicates.
        dialect.sqlToQuery(entry.value).sql.replaceAll(`"${config.name}".`, ""),
      ]),
    ),
    indexes: Object.fromEntries(
      config.indexes.map((entry) => [entry.config.name, Boolean(entry.config.unique)]),
    ),
    index: (name) => {
      const entry = config.indexes.find((candidate) => candidate.config.name === name);
      return entry
        ? {
            unique: Boolean(entry.config.unique),
            columns: entry.config.columns.map((column) => column.name),
            partial: Boolean(entry.config.where),
          }
        : undefined;
    },
    foreignKeys: config.foreignKeys.map((entry) => {
      const reference = entry.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        table: getTableConfig(reference.foreignTable).name,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: entry.onDelete,
      };
    }),
  };
}

/** Every check body concatenated, for "no column of this shape is constrained anywhere" probes. */
function checkBodies(described) {
  return Object.values(described.checks).join(" ");
}

function referencedTables(described) {
  return described.foreignKeys.map((fk) => fk.table);
}

const MARKETPLACE_TABLES = {
  marketplaceContacts: "marketplace_contacts",
  buyRequests: "buy_requests",
  sellSubmissions: "sell_submissions",
  sellSubmissionItems: "sell_submission_items",
  emailVerificationTokens: "email_verification_tokens",
  marketplaceUploadSessions: "marketplace_upload_sessions",
  marketplacePendingUploads: "marketplace_pending_uploads",
  marketplaceAttachments: "marketplace_attachments",
  marketplaceNotes: "marketplace_notes",
  supplierResponses: "supplier_responses",
  buyerOffers: "buyer_offers",
};

/* ---------------------------------------------------------------------------
 * Presence and shape
 * ------------------------------------------------------------------------ */

test("every marketplace table is exported under its expected physical name", () => {
  for (const [exportName, physicalName] of Object.entries(MARKETPLACE_TABLES)) {
    assert.ok(schema[exportName], `schema does not export ${exportName}`);
    assert.equal(table(schema[exportName]).name, physicalName);
  }
});

test("marketplace tables reuse existing admin/Price Check targets and create no duplicate audit or outbox table", () => {
  // Reuse, not duplication: no marketplace-specific audit/outbox table exists.
  const duplicated = Object.keys(schema).filter((exportName) =>
    /^(marketplace|buy|sell|supplier|buyer)/i.test(exportName) &&
    /(AuditEvents|Outbox)$/.test(exportName),
  );
  assert.deepEqual(duplicated, []);

  // The generic tables the marketplace is meant to reuse are still the only ones.
  assert.equal(table(schema.auditEvents).name, "audit_events");
  assert.equal(table(schema.notificationOutbox).name, "notification_outbox");

  // audit_events/notification_outbox stay workflow-neutral varchar aggregates,
  // so marketplace rows need no schema change to land in them.
  for (const generic of [schema.auditEvents, schema.notificationOutbox]) {
    const described = table(generic);
    assert.equal(described.column("aggregate_type").columnType, "PgVarchar");
    assert.equal(described.column("aggregate_type").notNull, true);
  }

  // Staff assignment reuses admin_users rather than a marketplace user table.
  for (const owner of [schema.buyRequests, schema.sellSubmissions]) {
    const assignee = table(owner).foreignKeys.find((fk) =>
      fk.columns.includes("assigned_admin_user_id"),
    );
    assert.equal(assignee.table, "admin_users");
    assert.equal(assignee.onDelete, "set null");
  }
});

/* ---------------------------------------------------------------------------
 * Buyer <-> Civilon and Supplier <-> Civilon separation
 * ------------------------------------------------------------------------ */

test("buyer_offers carries no supplier identity or supplier cost column", () => {
  const offers = table(schema.buyerOffers);

  // The only permitted supplier-adjacent column is the internal staff pointer.
  const supplierColumns = offers.columns.filter((name) => /supplier/.test(name));
  assert.deepEqual(supplierColumns, ["selected_supplier_response_id"]);

  // No cost-side pricing may exist here; only Civilon's own resale price.
  const forbidden = offers.columns.filter((name) =>
    /(^|_)(cost|supplier_cost|supplier_price|buy_price|purchase_price|margin)($|_)/.test(name),
  );
  assert.deepEqual(forbidden, []);

  // Explicit denial list: none of the supplier_responses identity/cost columns
  // may be duplicated onto the buyer-facing offer.
  const responses = table(schema.supplierResponses);
  const privateSupplierColumns = [
    "supplier_kind",
    "supplier_contact_id",
    "supplier_name_snapshot",
    "supplier_contact_snapshot",
    "supplier_country",
    "supplier_unit_cost",
  ];
  for (const column of privateSupplierColumns) {
    assert.ok(
      responses.columns.includes(column),
      `supplier_responses should own ${column}`,
    );
    assert.ok(
      !offers.columns.includes(column),
      `buyer_offers must not expose supplier column ${column}`,
    );
  }

  // buyer_offers must not reach marketplace_contacts directly: the buyer is
  // resolved through the buy request, and the supplier is never reachable.
  assert.ok(!referencedTables(offers).includes("marketplace_contacts"));
  assert.deepEqual(
    [...referencedTables(offers)].sort(),
    ["admin_users", "buy_requests", "supplier_responses"],
  );

  // The supplier pointer is nullable and severable, so deleting a sourcing
  // response can never cascade into the buyer-facing offer record.
  assert.equal(offers.column("selected_supplier_response_id").notNull, false);
  const pointer = offers.foreignKeys.find((fk) =>
    fk.columns.includes("selected_supplier_response_id"),
  );
  assert.equal(pointer.table, "supplier_responses");
  assert.equal(pointer.onDelete, "set null");
});

test("buyer_offers prices only Civilon's own resale side", () => {
  const offers = table(schema.buyerOffers);

  assert.equal(offers.column("civilon_sale_unit_price").notNull, true);
  assert.equal(offers.column("currency_code").notNull, true);
  assert.equal(offers.column("quantity").notNull, true);

  assert.match(
    offers.checks.buyer_offers_sale_price_nonnegative_chk,
    /"civilon_sale_unit_price" >= 0/,
  );
  assert.match(offers.checks.buyer_offers_quantity_positive_chk, /"quantity" > 0/);
  assert.match(offers.checks.buyer_offers_version_positive_chk, /"version" > 0/);
  assert.equal(offers.indexes.buyer_offers_version_uidx, true);

  // No certification/airworthiness/guarantee/confirmed-availability semantics.
  const forbiddenSemantics =
    /(certif|airworth|guarant|warrant|authentic|approved_by_civilon|confirmed_available)/;
  for (const column of offers.columns) {
    assert.ok(!forbiddenSemantics.test(column), `buyer_offers.${column} implies a prohibited claim`);
  }
});

test("buyer-facing delivery options never name a supplier-direct route", () => {
  // Direct supplier-to-buyer shipment is an internal Civilon fulfilment
  // decision. Exposing it as a buyer-facing label would reveal that a separate
  // supplier exists and that Civilon is not shipping from its own stock.
  assert.deepEqual(schema.buyerOfferDeliveryOptionEnum.enumValues, [
    "door_delivery",
    "port_of_entry",
    "nj_pickup",
    "not_determined",
  ]);
  assert.ok(
    !schema.buyerOfferDeliveryOptionEnum.enumValues.includes("supplier_direct"),
  );
  for (const value of schema.buyerOfferDeliveryOptionEnum.enumValues) {
    assert.ok(
      !/(supplier|vendor|seller|direct_from|drop_?ship)/.test(value),
      `buyer_offer_delivery_option '${value}' leaks the supplier relationship`,
    );
  }

  // The buyer-facing scope text is free-form, but the enum is the only thing
  // that can become a rendered label, and it stays supplier-free.
  const offers = table(schema.buyerOffers);
  assert.equal(offers.column("delivery_option").notNull, true);
  assert.equal(offers.column("delivery_option").hasDefault, true);
});

test("supplier_responses keeps supplier cost private and accepts registered or nonregistered suppliers", () => {
  const responses = table(schema.supplierResponses);

  // Private cost side lives here and is optional (quote-on-request by default).
  assert.equal(responses.column("supplier_unit_cost").notNull, false);
  assert.equal(responses.column("quote_on_request").notNull, true);
  assert.equal(responses.column("quote_on_request").hasDefault, true);
  assert.match(
    responses.checks.supplier_responses_cost_nonnegative_chk,
    /"supplier_unit_cost" is null or "supplier_unit_cost" >= 0/,
  );
  assert.match(
    responses.checks.supplier_responses_cost_currency_chk,
    /"supplier_unit_cost" is null or "currency_code" is not null/,
  );

  // Registered contact OR nonregistered snapshot, never an unattributed row.
  assert.deepEqual(schema.supplierSourceKindEnum.enumValues, [
    "registered_contact",
    "nonregistered_supplier",
  ]);
  const kindCheck = responses.checks.supplier_responses_supplier_kind_chk;
  assert.match(kindCheck, /'registered_contact' and "supplier_contact_id" is not null/);
  assert.match(
    kindCheck,
    /'nonregistered_supplier' and "supplier_contact_id" is null and nullif\(btrim\("supplier_name_snapshot"\), ''\) is not null/,
  );

  // A sourcing response always hangs off a Buy Request and never off an offer.
  const parent = responses.foreignKeys.find((fk) => fk.columns.includes("buy_request_id"));
  assert.equal(parent.table, "buy_requests");
  assert.equal(responses.column("buy_request_id").notNull, true);
  assert.ok(!referencedTables(responses).includes("buyer_offers"));

  // Supplier availability is never recorded as a Civilon confirmation.
  assert.equal(
    schema.supplierAvailabilityStateEnum.enumValues[0],
    "subject_to_confirmation",
  );
  assert.equal(responses.column("availability_state").hasDefault, true);
  assert.ok(
    !schema.supplierAvailabilityStateEnum.enumValues.some((value) =>
      /^(confirmed|guaranteed|certified)/.test(value),
    ),
  );
});

/* ---------------------------------------------------------------------------
 * Buy request rules
 * ------------------------------------------------------------------------ */

test("buy_requests enforces BR- format, part-or-description, quantity and idempotency", () => {
  const requests = table(schema.buyRequests);

  assert.match(
    requests.checks.buy_requests_public_reference_chk,
    /~ '\^BR-\[0-9A-HJKMNP-TV-Z\]\{10\}\$'/,
  );
  assert.equal(requests.indexes.buy_requests_public_reference_uidx, true);
  assert.equal(requests.indexes.buy_requests_idempotency_hash_uidx, true);
  assert.equal(requests.column("idempotency_hash").notNull, true);

  // Part number OR free-text description, with both individually nullable.
  assert.equal(requests.column("original_part_number").notNull, false);
  assert.equal(requests.column("description").notNull, false);
  assert.match(
    requests.checks.buy_requests_part_or_description_chk,
    /nullif\(btrim\("original_part_number"\), ''\) is not null or nullif\(btrim\("description"\), ''\) is not null/,
  );
  assert.match(
    requests.checks.buy_requests_normalized_part_number_chk,
    /\("original_part_number" is null\) = \("normalized_part_number" is null\)/,
  );

  assert.match(requests.checks.buy_requests_quantity_positive_chk, /"quantity" > 0/);
  assert.match(requests.checks.buy_requests_delivery_country_chk, /~ '\^\[A-Z\]\{2\}\$'/);
});

test("buy_requests treats pending_verification as a normal persisted state", () => {
  const requests = table(schema.buyRequests);

  // Unverified rows persist and stay visible to staff — they are the default.
  assert.equal(schema.buyRequestStatusEnum.enumValues[0], "pending_verification");
  assert.equal(requests.column("status").notNull, true);
  assert.equal(requests.column("status").hasDefault, true);
  assert.equal(requests.column("verified_at").notNull, false);

  // pending_verification <=> not yet verified, without hiding or deleting rows.
  assert.match(
    requests.checks.buy_requests_verified_status_chk,
    /"status" <> 'pending_verification' or "verified_at" is null/,
  );
  assert.match(
    requests.checks.buy_requests_verified_order_chk,
    /"verified_at" is null or "verified_at" >= "submitted_at"/,
  );

  // No soft-hide/visibility column exists that could suppress a pending row.
  for (const column of requests.columns) {
    assert.ok(
      !/(hidden|is_visible|published|listed|public_listing)/.test(column),
      `buy_requests.${column} would gate visibility of a pending record`,
    );
  }
});

test("buy_requests links optionally and immutably to an existing Price Check result", () => {
  const requests = table(schema.buyRequests);

  const links = requests.foreignKeys.filter((fk) =>
    fk.columns.includes("source_price_check_id") || fk.columns.includes("source_result_id"),
  );
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((fk) => fk.table).sort(),
    ["price_check_results", "price_checks"],
  );
  for (const link of links) {
    // Immutable provenance: RESTRICT, never SET NULL. A cited Price Check or
    // result cannot be deleted out from under a Buy Request, and the link
    // itself cannot be silently blanked by a delete elsewhere.
    assert.equal(
      link.onDelete,
      "restrict",
      `${link.columns.join(",")} must be RESTRICT so provenance stays immutable`,
    );
    assert.notEqual(link.onDelete, "set null");
    assert.notEqual(link.onDelete, "cascade");
  }
  assert.equal(requests.column("source_price_check_id").notNull, false);
  assert.equal(requests.column("source_result_id").notNull, false);

  // Reserved admin-only sourcing intelligence: present, nullable, never a claim.
  assert.equal(requests.column("external_source_intelligence").notNull, false);
  assert.equal(requests.column("external_source_intelligence").columnType, "PgJsonb");
});

/* ---------------------------------------------------------------------------
 * Sell submission rules
 * ------------------------------------------------------------------------ */

test("sell_submissions enforces SS- format, single/bulk mode and optional seller price", () => {
  const submissions = table(schema.sellSubmissions);

  assert.match(
    submissions.checks.sell_submissions_public_reference_chk,
    /~ '\^SS-\[0-9A-HJKMNP-TV-Z\]\{10\}\$'/,
  );
  assert.equal(submissions.indexes.sell_submissions_public_reference_uidx, true);
  assert.equal(submissions.indexes.sell_submissions_idempotency_hash_uidx, true);

  // Mode check: single part needs an identifier; bulk carries no single part.
  assert.deepEqual(schema.sellSubmissionKindEnum.enumValues, [
    "single_part",
    "bulk_inventory",
  ]);
  const modeCheck = submissions.checks.sell_submissions_mode_chk;
  assert.match(modeCheck, /'single_part' and \(nullif\(btrim\(.*original_part_number.*\)/);
  assert.match(
    modeCheck,
    /'bulk_inventory' and "original_part_number" is null and "quantity" is null and "asking_unit_price" is null/,
  );

  // Seller price is optional and normally quote-on-request.
  assert.equal(submissions.column("asking_unit_price").notNull, false);
  assert.equal(submissions.column("currency_code").notNull, false);
  assert.equal(submissions.column("quote_on_request").notNull, true);
  assert.equal(submissions.column("quote_on_request").hasDefault, true);
  assert.match(
    submissions.checks.sell_submissions_quote_on_request_chk,
    /"quote_on_request" or "asking_unit_price" is not null/,
  );
  assert.match(
    submissions.checks.sell_submissions_price_nonnegative_chk,
    /"asking_unit_price" is null or "asking_unit_price" >= 0/,
  );
  assert.match(
    submissions.checks.sell_submissions_quantity_chk,
    /"quantity" is null or "quantity" > 0/,
  );

  // Shipment to the New Jersey facility is optional and may be left unstated.
  assert.equal(submissions.column("can_ship_to_new_jersey").notNull, false);

  // Pending verification is a normal persisted state here too.
  assert.equal(schema.sellSubmissionStatusEnum.enumValues[0], "pending_verification");
  assert.match(
    submissions.checks.sell_submissions_verified_status_chk,
    /"status" <> 'pending_verification' or "verified_at" is null/,
  );
});

test("sell_submission_items are internal rows with no public listing or required price", () => {
  const items = table(schema.sellSubmissionItems);

  const parent = items.foreignKeys.find((fk) => fk.columns.includes("sell_submission_id"));
  assert.equal(parent.table, "sell_submissions");
  assert.equal(parent.onDelete, "cascade");
  assert.equal(items.indexes.sell_submission_items_line_uidx, true);
  assert.match(items.checks.sell_submission_items_line_number_chk, /"line_number" > 0/);

  assert.match(
    items.checks.sell_submission_items_part_or_description_chk,
    /original_part_number.*is not null or nullif\(btrim\(.*description/s,
  );
  assert.equal(items.column("asking_unit_price").notNull, false);
  assert.match(
    items.checks.sell_submission_items_price_nonnegative_chk,
    /"asking_unit_price" is null or "asking_unit_price" >= 0/,
  );

  // No publication, search, or public-visibility state of any kind.
  for (const column of items.columns) {
    assert.ok(
      !/(published|listed|public|searchable|visible|catalog)/.test(column),
      `sell_submission_items.${column} would create public listing state`,
    );
  }
});

/* ---------------------------------------------------------------------------
 * Verification tokens
 * ------------------------------------------------------------------------ */

test("email_verification_tokens stores no plaintext token and holds one active token per aggregate", () => {
  const tokens = table(schema.emailVerificationTokens);

  // Hash + nonce only: no plaintext/secret/raw token column may exist.
  assert.ok(tokens.columns.includes("keyed_token_hash"));
  assert.ok(tokens.columns.includes("token_derivation_nonce"));
  for (const column of tokens.columns) {
    assert.ok(
      !/(plaintext|plain_token|raw_token|token_value|secret)/.test(column),
      `email_verification_tokens.${column} would persist a recoverable token`,
    );
  }
  assert.equal(tokens.indexes.email_verification_tokens_hash_uidx, true);

  // Exactly one live token per aggregate, history preserved. The index must be
  // keyed on (aggregate_type, aggregate_id), not aggregate_id alone: a Buy
  // Request and a Sell Submission are separate ULID namespaces, so keying on
  // the id alone would let one workflow's live token block the other's.
  const active = tokens.index("email_verification_tokens_active_uidx");
  assert.ok(active, "email_verification_tokens_active_uidx is missing");
  assert.equal(active.unique, true);
  assert.equal(active.partial, true);
  assert.deepEqual(active.columns, ["aggregate_type", "aggregate_id"]);
  assert.match(
    tokens.checks.email_verification_tokens_lifecycle_chk,
    /"consumed_at" is null or "revoked_at" is null/,
  );
  assert.match(
    tokens.checks.email_verification_tokens_expiry_chk,
    /"expires_at" > "issued_at"/,
  );
  assert.match(
    tokens.checks.email_verification_tokens_attempt_chk,
    /"attempt_count" >= 0 and "max_attempt_count" > 0/,
  );

  // Generic across Buy and Sell, and only across those two.
  assert.deepEqual(schema.marketplaceAggregateTypeEnum.enumValues, [
    "buy_request",
    "sell_submission",
  ]);
  assert.match(
    tokens.checks.email_verification_tokens_aggregate_chk,
    /'buy_request' and "buy_request_id" = "aggregate_id"/,
  );
  assert.match(
    tokens.checks.email_verification_tokens_purpose_chk,
    /'sell_submission' and "purpose" = 'SELL_SUBMISSION_CONTACT'/,
  );
});

/* ---------------------------------------------------------------------------
 * Upload isolation
 * ------------------------------------------------------------------------ */

test("marketplace upload tables are structurally unable to touch Price Check uploads", () => {
  const sessions = table(schema.marketplaceUploadSessions);
  const pending = table(schema.marketplacePendingUploads);
  const attachments = table(schema.marketplaceAttachments);

  // No marketplace upload table references any Price Check object.
  const priceCheckTables = new Set([
    "price_checks",
    "price_check_results",
    "price_check_upload_sessions",
    "price_check_pending_uploads",
    "attachments",
  ]);
  for (const described of [sessions, pending, attachments]) {
    for (const referenced of referencedTables(described)) {
      assert.ok(
        !priceCheckTables.has(referenced),
        `${described.name} must not reference Price Check table ${referenced}`,
      );
    }
    for (const column of described.columns) {
      assert.ok(
        !/price_check/.test(column),
        `${described.name}.${column} would couple marketplace uploads to Price Check`,
      );
    }
  }

  // Symmetrically, the Price Check upload tables gain no marketplace column.
  const priceCheckPending = table(schema.pendingUploads);
  assert.ok(priceCheckPending.columns.includes("claimed_price_check_id"));
  for (const column of priceCheckPending.columns) {
    assert.ok(!/(marketplace|buy_request|sell_submission)/.test(column));
  }
  for (const column of table(schema.attachments).columns) {
    assert.ok(!/(marketplace|buy_request|sell_submission)/.test(column));
  }

  // Claims resolve only to marketplace aggregates, and never to both at once.
  assert.deepEqual(
    [...referencedTables(pending)].sort(),
    ["buy_requests", "marketplace_upload_sessions", "sell_submissions"],
  );
  assert.match(
    pending.checks.marketplace_pending_uploads_single_claim_chk,
    /"claimed_buy_request_id" is null or "claimed_sell_submission_id" is null/,
  );
  assert.match(
    pending.checks.marketplace_pending_uploads_bound_claim_chk,
    /"state" <> 'BOUND' or "claimed_buy_request_id" is not null or "claimed_sell_submission_id" is not null/,
  );

  // Separate storage namespace, separate session token table.
  assert.match(
    pending.checks.marketplace_pending_uploads_object_key_chk,
    /"object_key" like 'marketplace\/%'/,
  );
  assert.match(
    attachments.checks.marketplace_attachments_object_key_chk,
    /"object_key" like 'marketplace\/%'/,
  );
  assert.equal(sessions.indexes.marketplace_upload_sessions_token_hash_uidx, true);
  assert.equal(sessions.column("intended_aggregate_type").notNull, true);
});

test("marketplace attachments preserve quarantine, scan and retention concepts under their own enums", () => {
  const attachments = table(schema.marketplaceAttachments);

  assert.deepEqual(schema.marketplaceScanStateEnum.enumValues, [
    "PENDING",
    "QUARANTINED",
    "CLEAN",
    "REJECTED",
    "FAILED",
  ]);
  assert.equal(schema.marketplaceScanStateEnum.enumName, "marketplace_scan_state");
  assert.equal(attachments.column("scan_state").hasDefault, true);
  assert.match(
    attachments.checks.marketplace_attachments_quarantine_chk,
    /"quarantine_released_at" is null or "scan_state" = 'CLEAN'/,
  );

  assert.equal(attachments.column("retention_class").notNull, true);
  assert.ok(attachments.columns.includes("deletion_due_at"));
  assert.ok(attachments.columns.includes("deleted_at"));

  // Purposes cover the Phase 1 evidence set without a mandatory KYC workflow.
  assert.deepEqual(schema.marketplaceUploadPurposeEnum.enumValues, [
    "INVENTORY_SPREADSHEET",
    "WAREHOUSE_BUSINESS_EVIDENCE",
    "CUSTODY_PART_PHOTO",
    "PART_NUMBER_SERIAL_PHOTO",
    "RELEASE_SUPPORTING_DOCUMENT",
    "OTHER",
  ]);
  assert.equal(attachments.column("purpose").notNull, true);
});

/* ---------------------------------------------------------------------------
 * Aggregate-type consistency and internal notes
 * ------------------------------------------------------------------------ */

test("every polymorphic marketplace child pins its aggregate type to exactly one parent", () => {
  const polymorphic = [
    [schema.emailVerificationTokens, "email_verification_tokens_aggregate_chk"],
    [schema.marketplaceAttachments, "marketplace_attachments_aggregate_chk"],
    [schema.marketplaceNotes, "marketplace_notes_aggregate_chk"],
  ];

  for (const [pgTable, checkName] of polymorphic) {
    const described = table(pgTable);
    assert.ok(described.columns.includes("aggregate_type"));
    assert.ok(described.columns.includes("aggregate_id"));
    assert.equal(described.column("aggregate_type").notNull, true);
    assert.equal(described.column("aggregate_id").notNull, true);

    const body = described.checks[checkName];
    assert.ok(body, `${described.name} is missing ${checkName}`);
    // Buy branch: buy FK equals aggregate id and the sell FK is null (and vice versa).
    assert.match(body, /'buy_request' and "buy_request_id" = .*"aggregate_id" and "sell_submission_id" is null/);
    assert.match(body, /'sell_submission' and "sell_submission_id" = .*"aggregate_id" and "buy_request_id" is null/);

    const parents = referencedTables(described).filter((name) =>
      name === "buy_requests" || name === "sell_submissions",
    );
    assert.deepEqual([...parents].sort(), ["buy_requests", "sell_submissions"]);
  }
});

test("marketplace_notes are internal staff records tied to an admin user", () => {
  const notes = table(schema.marketplaceNotes);

  const author = notes.foreignKeys.find((fk) => fk.columns.includes("admin_user_id"));
  assert.equal(author.table, "admin_users");
  assert.equal(author.onDelete, "restrict");
  assert.equal(notes.column("admin_user_id").notNull, true);
  assert.equal(notes.column("body").notNull, true);
  assert.match(
    notes.checks.marketplace_notes_body_chk,
    /nullif\(btrim\("body"\), ''\) is not null/,
  );

  // Internal only: no customer-visible flag exists on a staff note.
  for (const column of notes.columns) {
    assert.ok(!/(customer_visible|public|shared_with)/.test(column));
  }
});

/* ---------------------------------------------------------------------------
 * Contacts, enum isolation, and non-alteration of existing definitions
 * ------------------------------------------------------------------------ */

test("marketplace_contacts is separate from Price Check requesters and may act as buyer and seller", () => {
  const contacts = table(schema.marketplaceContacts);

  assert.notEqual(contacts.name, table(schema.requesters).name);
  assert.equal(contacts.column("acts_as_buyer").notNull, true);
  assert.equal(contacts.column("acts_as_seller").notNull, true);

  // Same email may appear as buyer and as supplier: the index is NOT unique.
  assert.equal(contacts.indexes.marketplace_contacts_normalized_email_idx, false);
  assert.match(
    contacts.checks.marketplace_contacts_normalized_email_chk,
    /"normalized_email" = lower\("normalized_email"\)/,
  );

  // Lightweight verification: unverified is the default persisted state.
  assert.equal(schema.marketplaceVerificationStateEnum.enumValues[0], "UNVERIFIED");
  assert.equal(contacts.column("verification_state").hasDefault, true);
  assert.match(
    contacts.checks.marketplace_contacts_verified_state_chk,
    /"verification_state" <> 'VERIFIED' or "verified_at" is not null/,
  );

  // Buy and Sell aggregates both hang off this table, not off requesters.
  for (const aggregate of [schema.buyRequests, schema.sellSubmissions]) {
    const described = table(aggregate);
    const contact = described.foreignKeys.find((fk) => fk.columns.includes("contact_id"));
    assert.equal(contact.table, "marketplace_contacts");
    assert.equal(contact.onDelete, "restrict");
    assert.equal(described.column("contact_id").notNull, true);
    assert.ok(!referencedTables(described).includes("requesters"));
  }
});

test("marketplace uses only new enums and leaves existing Price Check enums untouched", () => {
  const marketplaceEnums = [
    schema.marketplaceAggregateTypeEnum,
    schema.marketplaceVerificationStateEnum,
    schema.buyRequestStatusEnum,
    schema.sellSubmissionStatusEnum,
    schema.sellSubmissionKindEnum,
    schema.marketplaceUrgencyEnum,
    schema.marketplaceConditionCodeEnum,
    schema.marketplaceFulfillmentPreferenceEnum,
    schema.emailVerificationPurposeEnum,
    schema.marketplaceUploadStateEnum,
    schema.marketplaceUploadPurposeEnum,
    schema.marketplaceScanStateEnum,
    schema.marketplaceRetentionClassEnum,
    schema.marketplaceUploadedByTypeEnum,
    schema.supplierSourceKindEnum,
    schema.supplierResponseStatusEnum,
    schema.supplierAvailabilityStateEnum,
    schema.buyerOfferStatusEnum,
    schema.buyerOfferDeliveryOptionEnum,
  ];

  const existingEnumNames = new Set([
    "admin_role",
    "price_check_status",
    "quote_or_purchased",
    "price_check_transaction_type",
    "price_check_condition_code",
    "core_disposition",
    "warranty_unit",
    "documentation_code",
    "price_check_actor_type",
    "attachment_uploaded_by_type",
    "attachment_scan_state",
    "attachment_retention_class",
    "extraction_status",
    "extraction_acceptance_state",
    "observation_provenance_type",
    "source_reliability",
    "verification_state",
    "permitted_use_state",
    "deidentification_state",
    "part_relationship_type",
    "analysis_confidence",
    "analysis_review_state",
    "ai_validation_state",
    "processing_job_state",
    "processing_job_type",
    "notification_outbox_state",
    "price_check_upload_state",
    "price_check_result_state",
    "sourcing_opportunity_status",
  ]);

  const names = marketplaceEnums.map((pgEnum) => pgEnum.enumName);
  assert.equal(new Set(names).size, names.length, "marketplace enum names must be unique");
  for (const name of names) {
    assert.ok(!existingEnumNames.has(name), `${name} collides with an existing enum`);
    assert.ok(name.length <= 63, `${name} exceeds the PostgreSQL identifier limit`);
  }

  // Existing enums keep their exact values: no marketplace value was added.
  assert.deepEqual(schema.conditionCodeEnum.enumValues, [
    "NE",
    "NS",
    "OH",
    "SV",
    "AR",
    "NOT_SURE",
  ]);
  assert.deepEqual(schema.retentionClassEnum.enumValues, [
    "PRICE_CHECK_EVIDENCE",
    "TEMPORARY_PROCESSING",
    "LEGAL_HOLD",
  ]);
  assert.deepEqual(schema.uploadedByTypeEnum.enumValues, [
    "REQUESTER",
    "ADMIN",
    "SYSTEM",
  ]);
  assert.deepEqual(schema.verificationStateEnum.enumValues, [
    "UNVERIFIED",
    "PENDING",
    "VERIFIED",
    "REJECTED",
  ]);
  assert.deepEqual(schema.actorTypeEnum.enumValues, [
    "REQUESTER",
    "ADMIN",
    "SYSTEM",
    "WORKER",
  ]);

  // The marketplace condition set is its own enum, widened with ANY.
  assert.equal(
    schema.marketplaceConditionCodeEnum.enumName,
    "marketplace_condition_code",
  );
  assert.ok(schema.marketplaceConditionCodeEnum.enumValues.includes("ANY"));
  assert.ok(schema.marketplaceConditionCodeEnum.enumValues.includes("NOT_SURE"));
});

test("existing Price Check table definitions are unchanged by the marketplace package", () => {
  const priceChecks = table(schema.priceChecks);
  assert.match(
    priceChecks.checks.price_checks_public_reference_chk,
    /~ '\^PC-\[0-9A-HJKMNP-TV-Z\]\{10\}\$'/,
  );
  assert.equal(priceChecks.indexes.price_checks_public_reference_uidx, true);
  assert.equal(priceChecks.indexes.price_checks_idempotency_hash_uidx, true);

  // No marketplace column leaked into any existing Price Check aggregate.
  const existing = [
    schema.priceChecks,
    schema.requesters,
    schema.priceCheckResults,
    schema.resultAccessTokens,
    schema.uploadSessions,
    schema.sourcingOpportunities,
  ];
  for (const pgTable of existing) {
    const described = table(pgTable);
    for (const column of described.columns) {
      assert.ok(
        !/(marketplace|buy_request|sell_submission|supplier_response|buyer_offer)/.test(column),
        `${described.name}.${column} is a marketplace column on an existing table`,
      );
    }
  }

  // The marketplace never reaches into the analysis/result chain except through
  // the two optional, severable buy_requests links.
  const linkColumns = table(schema.buyRequests)
    .foreignKeys.filter((fk) => fk.table === "price_checks" || fk.table === "price_check_results")
    .flatMap((fk) => fk.columns);
  assert.deepEqual([...linkColumns].sort(), ["source_price_check_id", "source_result_id"]);
});

test("no marketplace table defines checkout, payment, order, shipment or warranty state", () => {
  const forbidden =
    /(checkout|payment|invoice|purchase_order|sales_order|shipment|tracking_number|warranty|return_|refund|company_score|legitimacy)/;

  for (const exportName of Object.keys(MARKETPLACE_TABLES)) {
    const described = table(schema[exportName]);
    for (const column of described.columns) {
      assert.ok(
        !forbidden.test(column),
        `${described.name}.${column} is out of scope for this slice`,
      );
    }
    assert.ok(!forbidden.test(checkBodies(described)));
  }
});
