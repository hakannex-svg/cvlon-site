import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  csvBytes,
  jpegBytes,
  oleBytes,
  pdfBytes,
  pngBytes,
  webpBytes,
  xlsmBytes,
  xlsxBytes,
} from "./fixtures/marketplace-upload-bytes.mjs";

import {
  MARKETPLACE_OBJECT_PREFIX,
  MARKETPLACE_PHOTO_MAX_BYTES,
  MARKETPLACE_QUARANTINE_PREFIX,
  MARKETPLACE_UPLOAD_ALLOWED_MIME,
  MARKETPLACE_UPLOAD_COOKIE,
  MARKETPLACE_UPLOAD_MAX_BYTES,
  MARKETPLACE_UPLOAD_MAX_FILES,
  MARKETPLACE_UPLOAD_MAX_SESSION_BYTES,
  marketplaceMimeForPurpose,
  marketplaceUploadPurposes,
} from "../lib/marketplace/uploads/constants.ts";
import {
  sanitizeMarketplaceUploadFilename,
  validateMarketplaceUploadDeclaration,
  verifyMarketplaceUploadContent,
} from "../lib/marketplace/uploads/file-validation.ts";
import {
  hashMarketplaceUploadSessionToken,
  isMarketplaceUploadSessionToken,
  marketplaceUploadSessionCookie,
  newMarketplaceUploadSessionToken,
  readMarketplaceUploadCookie,
} from "../lib/marketplace/uploads/session.ts";
import { hashUploadSessionToken } from "../lib/price-check/uploads/session.ts";
import { PRICE_CHECK_UPLOAD_COOKIE } from "../lib/price-check/uploads/constants.ts";
import {
  isRetryableScanCode,
  marketplaceScanDecision,
} from "../lib/marketplace/uploads/scan.ts";
import {
  getMarketplaceUploadStorageConfig,
  isMarketplaceUploadStorageConfigured,
} from "../lib/marketplace/uploads/config.ts";
import { isSupportedUploadAggregate } from "../lib/marketplace/uploads/authorization.ts";
import { validateSellSubmission } from "../lib/marketplace/sell-validation.ts";
import {
  SELL_SUBMISSION_SOURCE_PAGE,
  sellSubmissionReservedUploadFields,
} from "../lib/marketplace/sell-contract.ts";

const SESSION_KEY = "civilon-marketplace-upload-session-key-for-tests";
const HANDLE = "01M06PHA5E7P10AD0000000001";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function declaration(overrides = {}) {
  return {
    filename: "inventory.csv",
    mime: "text/csv",
    size: 4096,
    purpose: "INVENTORY_SPREADSHEET",
    ...overrides,
  };
}

function sellPayload(overrides = {}) {
  return {
    idempotencyKey: "3f1a2b4c-5d6e-4f70-8123-456789abcdef",
    submissionKind: "single_part",
    partNumber: "101-384025-5",
    firstName: "Sam",
    lastName: "Okafor",
    companyName: "Example Component Supply",
    businessEmail: "sam.okafor@example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: SELL_SUBMISSION_SOURCE_PAGE,
    ...overrides,
  };
}

/** Verifies a whole body by handing the same buffer as head and tail. */
function verifyWhole(bytes, declaredMime) {
  return verifyMarketplaceUploadContent({
    head: new Uint8Array(bytes),
    tail: new Uint8Array(bytes),
    size: bytes.length,
    declaredMime,
  });
}

/* --------------------------------------------------------------- limits */

test("the documented limits match the ceilings the approved schema encodes", () => {
  assert.equal(MARKETPLACE_UPLOAD_MAX_FILES, 12);
  assert.equal(MARKETPLACE_UPLOAD_MAX_BYTES, 52_428_800);
  assert.equal(MARKETPLACE_UPLOAD_MAX_SESSION_BYTES, 209_715_200);
  assert.equal(MARKETPLACE_PHOTO_MAX_BYTES, 26_214_400);

  const schema = readFileSync(
    new URL("../db/price-check/schema.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
    "utf8",
  );
  assert.ok(schema.includes("between 0 and 12"), "session count ceiling");
  assert.ok(schema.includes("between 0 and 209715200"), "session byte ceiling");
  assert.ok(schema.includes("between 1 and 52428800"), "per-file byte ceiling");
});

/* ------------------------------------------------------- declaration rules */

test("only the six accepted formats exist, and each maps to its own extensions", () => {
  assert.deepEqual([...MARKETPLACE_UPLOAD_ALLOWED_MIME], [
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
    "text/csv", XLSX_MIME,
  ]);
  // XLS, XLSM and a bare ZIP are absent by name, not merely unlisted by accident.
  for (const rejected of [
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/zip",
    "application/x-zip-compressed",
    "image/svg+xml",
    "text/html",
  ]) {
    assert.equal(MARKETPLACE_UPLOAD_ALLOWED_MIME.includes(rejected), false, rejected);
    assert.throws(
      () => validateMarketplaceUploadDeclaration(declaration({ mime: rejected })),
      /JPG, PNG, WebP, PDF, CSV or XLSX/,
      rejected,
    );
  }
});

test("each purpose accepts only the formats that make sense for it", () => {
  assert.deepEqual([...marketplaceUploadPurposes], [
    "INVENTORY_SPREADSHEET",
    "WAREHOUSE_BUSINESS_EVIDENCE",
    "CUSTODY_PART_PHOTO",
    "PART_NUMBER_SERIAL_PHOTO",
    "RELEASE_SUPPORTING_DOCUMENT",
    "OTHER",
  ]);

  // A spreadsheet may only arrive as an inventory list.
  for (const purpose of marketplaceUploadPurposes) {
    const spreadsheetAllowed = purpose === "INVENTORY_SPREADSHEET";
    assert.equal(marketplaceMimeForPurpose[purpose].includes("text/csv"), spreadsheetAllowed, purpose);
    assert.equal(marketplaceMimeForPurpose[purpose].includes(XLSX_MIME), spreadsheetAllowed, purpose);
  }
  // A custody or part-number photo may only be a photo.
  for (const purpose of ["CUSTODY_PART_PHOTO", "PART_NUMBER_SERIAL_PHOTO"]) {
    assert.equal(marketplaceMimeForPurpose[purpose].includes("application/pdf"), false, purpose);
    assert.throws(
      () => validateMarketplaceUploadDeclaration(declaration({
        filename: "release.pdf", mime: "application/pdf", purpose,
      })),
      /not accepted for the selected purpose/,
    );
  }
  assert.throws(
    () => validateMarketplaceUploadDeclaration(declaration({ purpose: "CUSTODY_PART_PHOTO" })),
    /not accepted for the selected purpose/,
    "a CSV cannot masquerade as a custody photo",
  );
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({ purpose: "ANYTHING" })), /what this file shows/);
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({ purpose: undefined })), /what this file shows/);
});

test("extension, size and field allowlist are enforced before anything is signed", () => {
  assert.deepEqual(validateMarketplaceUploadDeclaration(declaration()), {
    filename: "inventory.csv", mime: "text/csv", size: 4096, purpose: "INVENTORY_SPREADSHEET",
  });
  assert.deepEqual(
    validateMarketplaceUploadDeclaration(declaration({
      filename: "list.xlsx", mime: XLSX_MIME,
    })).mime,
    XLSX_MIME,
  );

  // Extension must match the declared type, in both directions.
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({ filename: "inventory.xlsx" })), /extension/);
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({
    filename: "list.csv", mime: XLSX_MIME,
  })), /extension/);
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({
    filename: "photo.jpeg.exe", mime: "image/jpeg", purpose: "CUSTODY_PART_PHOTO",
  })), /extension/);

  // Sizes: 50 MB generally, 25 MB for a photograph.
  assert.equal(validateMarketplaceUploadDeclaration(declaration({ size: MARKETPLACE_UPLOAD_MAX_BYTES })).size, MARKETPLACE_UPLOAD_MAX_BYTES);
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({ size: MARKETPLACE_UPLOAD_MAX_BYTES + 1 })), /50 MB/);
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({ size: 0 })), /50 MB/);
  const photo = { filename: "part.jpg", mime: "image/jpeg", purpose: "PART_NUMBER_SERIAL_PHOTO" };
  assert.equal(validateMarketplaceUploadDeclaration({ ...photo, size: MARKETPLACE_PHOTO_MAX_BYTES }).size, MARKETPLACE_PHOTO_MAX_BYTES);
  assert.throws(() => validateMarketplaceUploadDeclaration({ ...photo, size: MARKETPLACE_PHOTO_MAX_BYTES + 1 }), /25 MB/);
  assert.throws(() => validateMarketplaceUploadDeclaration(declaration({ size: 1.5 })), /50 MB/);

  // Nothing the client sends beyond the four declared fields is accepted —
  // an objectKey or handle here would let a caller name Civilon's storage.
  for (const field of ["objectKey", "handle", "uploadSessionId", "bucket", "scanState"]) {
    assert.throws(
      () => validateMarketplaceUploadDeclaration(declaration({ [field]: "x" })),
      /unsupported field/,
      field,
    );
  }
  assert.throws(() => validateMarketplaceUploadDeclaration(null), /supported file/);
  assert.throws(() => validateMarketplaceUploadDeclaration([declaration()]), /supported file/);
});

test("filenames are reduced to a display basename and never a path", () => {
  assert.equal(sanitizeMarketplaceUploadFilename("C:\\fakepath\\inventory.csv"), "inventory.csv");
  assert.equal(sanitizeMarketplaceUploadFilename("../../../etc/passwd.pdf"), "passwd.pdf");
  assert.equal(sanitizeMarketplaceUploadFilename("  list\u0000.csv  "), "list.csv");
  // A zero-width character makes two visually identical names that never
  // compare equal — a spoofing hazard in a staff-facing list.
  assert.equal(sanitizeMarketplaceUploadFilename("in\u200Bventory.csv"), "inventory.csv");
  assert.throws(() => sanitizeMarketplaceUploadFilename(".hidden"), /visible name/);
  assert.throws(() => sanitizeMarketplaceUploadFilename(`${"x".repeat(200)}.csv`), /180 characters/);
  assert.throws(() => sanitizeMarketplaceUploadFilename(42), /supported file/);
});

/* ------------------------------------------------------- content signatures */

test("photo and PDF signatures are verified and MIME spoofing is refused", () => {
  assert.equal(verifyWhole(pngBytes(), "image/png").detectedMime, "image/png");
  assert.equal(verifyWhole(jpegBytes(), "image/jpeg").detectedMime, "image/jpeg");
  assert.equal(verifyWhole(webpBytes(), "image/webp").detectedMime, "image/webp");
  assert.equal(verifyWhole(pdfBytes(), "application/pdf").detectedMime, "application/pdf");

  // Every cross-pairing is refused: the bytes decide, not the declaration.
  assert.throws(() => verifyWhole(pngBytes(), "image/jpeg"), /does not match its declared type/);
  assert.throws(() => verifyWhole(pdfBytes(), "image/png"), /does not match its declared type/);
  assert.throws(() => verifyWhole(jpegBytes(), "application/pdf"), /does not match its declared type/);
  assert.throws(() => verifyWhole(csvBytes(), "image/png"), /does not match its declared type/);

  assert.throws(() => verifyWhole(pdfBytes({ encrypted: true }), "application/pdf"), /Password-protected/);
  assert.throws(() => verifyWhole(pdfBytes({ truncated: true }), "application/pdf"), /incomplete/);
  const bomb = pngBytes({ width: 12_001 });
  assert.throws(() => verifyWhole(bomb, "image/png"), /dimensions are too large/);
});

test("CSV is accepted only as real text, never as a renamed binary", () => {
  assert.equal(verifyWhole(csvBytes(), "text/csv").detectedMime, "text/csv");
  assert.equal(verifyWhole(csvBytes("a,b\r\n1,2\r\n"), "text/csv").detectedMime, "text/csv");
  assert.equal(verifyWhole(csvBytes("\uFEFFpart,qty\n1,2\n"), "text/csv").detectedMime, "text/csv");

  // A legacy XLS is an OLE compound document. Renaming it .csv changes nothing.
  assert.throws(() => verifyWhole(oleBytes(), "text/csv"), /not a plain CSV/);
  assert.throws(() => verifyWhole(xlsxBytes(), "text/csv"), /does not match its declared type/);
  assert.throws(() => verifyWhole(pdfBytes(), "text/csv"), /does not match its declared type/);
  assert.throws(() => verifyWhole(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), "text/csv"), /not a plain CSV/);
  assert.throws(() => verifyWhole(Buffer.from("part,qty\n1\u00002\n", "latin1"), "text/csv"), /not a plain CSV/);
  assert.throws(() => verifyWhole(Buffer.from([0x70, 0x61, 0x72, 0x74, 0xff, 0xfe]), "text/csv"), /UTF-8/);
});

test("XLSX is accepted only when it is a macro-free, unencrypted spreadsheet", () => {
  assert.equal(verifyWhole(xlsxBytes(), XLSX_MIME).detectedMime, XLSX_MIME);

  // An XLSM renamed .xlsx: the macro project is named in the central directory.
  assert.throws(() => verifyWhole(xlsmBytes(), XLSX_MIME), /Macro-enabled/);
  // A plain ZIP renamed .xlsx: OOXML always stores [Content_Types].xml first.
  assert.throws(() => verifyWhole(xlsxBytes({ firstEntry: "payload.exe" }), XLSX_MIME), /not a valid XLSX/);
  // A password-protected archive: general-purpose bit 0 is set.
  assert.throws(() => verifyWhole(xlsxBytes({ flags: 0x0001 }), XLSX_MIME), /Password-protected/);
  // An encrypted OOXML file is an OLE container, not a ZIP at all.
  assert.throws(() => verifyWhole(oleBytes(), XLSX_MIME), /does not match its declared type/);
  // A DOCX has no xl/ parts.
  assert.throws(
    () => verifyWhole(xlsxBytes({ parts: ["word/document.xml"] }), XLSX_MIME),
    /not a valid XLSX/,
  );
});

test("the stored size is bounded and an empty object is never evidence", () => {
  assert.throws(() => verifyMarketplaceUploadContent({
    head: new Uint8Array(csvBytes()), tail: new Uint8Array(csvBytes()),
    size: MARKETPLACE_UPLOAD_MAX_BYTES + 1, declaredMime: "text/csv",
  }), /size is not allowed/);
  assert.throws(() => verifyMarketplaceUploadContent({
    head: new Uint8Array(pngBytes()), tail: new Uint8Array(pngBytes()),
    size: MARKETPLACE_PHOTO_MAX_BYTES + 1, declaredMime: "image/png",
  }), /size is not allowed/, "the photo ceiling applies to stored bytes too");
  assert.throws(() => verifyMarketplaceUploadContent({
    head: new Uint8Array(0), tail: new Uint8Array(0), size: 0, declaredMime: "text/csv",
  }), /size is not allowed/);
  assert.throws(() => verifyMarketplaceUploadContent({
    head: new Uint8Array(csvBytes()), tail: new Uint8Array(csvBytes()),
    size: 10, declaredMime: "application/zip",
  }), /file type is not accepted/);
});

/* ----------------------------------------------------------- session/cookie */

test("the upload cookie is host-only, HttpOnly, Secure and SameSite=Strict", () => {
  const token = newMarketplaceUploadSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(isMarketplaceUploadSessionToken(token), true);

  const cookie = marketplaceUploadSessionCookie(token);
  assert.match(cookie, /^__Host-cvlon_mk_upload=/);
  for (const flag of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict"]) {
    assert.match(cookie, new RegExp(flag));
  }
  // __Host- forbids Domain; a sibling host must never be able to set this.
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.notEqual(MARKETPLACE_UPLOAD_COOKIE, PRICE_CHECK_UPLOAD_COOKIE);
});

test("session ownership is a keyed HMAC that a Price Check cookie can never match", () => {
  const token = newMarketplaceUploadSessionToken();
  const hash = hashMarketplaceUploadSessionToken(SESSION_KEY, token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(token), false);
  assert.equal(hashMarketplaceUploadSessionToken(SESSION_KEY, token), hash, "stable for one key");

  // A different key yields a different hash: a database dump alone proves nothing.
  assert.notEqual(hashMarketplaceUploadSessionToken(`${SESSION_KEY}-other`, token), hash);
  // And the Price Check digest of the same value lands somewhere else entirely,
  // so a Price Check cookie presented here resolves no marketplace session.
  assert.notEqual(hashUploadSessionToken(token), hash);

  assert.throws(() => hashMarketplaceUploadSessionToken("too-short", token), /SESSION_KEY_UNAVAILABLE/);
});

test("a malformed or foreign cookie is discarded before any query runs", () => {
  const token = newMarketplaceUploadSessionToken();
  assert.equal(readMarketplaceUploadCookie(`__Host-cvlon_mk_upload=${token}`), token);
  assert.equal(readMarketplaceUploadCookie(`other=1; __Host-cvlon_mk_upload=${token}; x=2`), token);

  assert.equal(readMarketplaceUploadCookie(null), null);
  assert.equal(readMarketplaceUploadCookie(""), null);
  // The Price Check cookie is not read here even when it is present.
  assert.equal(readMarketplaceUploadCookie(`${PRICE_CHECK_UPLOAD_COOKIE}=${token}`), null);
  for (const bad of ["short", "a".repeat(65), "../../object-key", "'; drop table --"]) {
    assert.equal(readMarketplaceUploadCookie(`__Host-cvlon_mk_upload=${encodeURIComponent(bad)}`), null, bad);
  }
});

/* ------------------------------------------------------------------- scans */

test("scan decisions fail closed, and pending is distinguished from rejected", () => {
  assert.equal(marketplaceScanDecision("NO_THREATS_FOUND"), "CLEAN");
  assert.equal(marketplaceScanDecision("THREATS_FOUND"), "REJECTED");
  assert.equal(marketplaceScanDecision(undefined), "PENDING");
  assert.equal(marketplaceScanDecision(null), "PENDING");
  assert.equal(marketplaceScanDecision(""), "PENDING");
  for (const status of ["UNSUPPORTED", "ACCESS_DENIED", "FAILED", "NO_THREATS_FOUND ", "no_threats_found", "CLEAN"]) {
    assert.notEqual(marketplaceScanDecision(status), "CLEAN", status);
  }
  // Only "we have not finished" is retryable. "We found something" is not.
  assert.equal(isRetryableScanCode("MARKETPLACE_UPLOAD_SCAN_PENDING"), true);
  assert.equal(isRetryableScanCode("MARKETPLACE_UPLOAD_SCAN_UNAVAILABLE"), true);
  assert.equal(isRetryableScanCode("MARKETPLACE_UPLOAD_SCAN_REJECTED"), false);
});

/* ------------------------------------------------------------------ config */

test("marketplace storage is configured on its own variables and never inherits Price Check's", () => {
  const names = [
    "MARKETPLACE_UPLOAD_AWS_REGION", "MARKETPLACE_UPLOAD_BUCKET",
    "MARKETPLACE_UPLOAD_AWS_ACCESS_KEY_ID", "MARKETPLACE_UPLOAD_AWS_SECRET_ACCESS_KEY",
  ];
  const complete = {
    MARKETPLACE_UPLOAD_AWS_REGION: "us-east-1",
    MARKETPLACE_UPLOAD_BUCKET: "civilon-marketplace-test",
    MARKETPLACE_UPLOAD_AWS_ACCESS_KEY_ID: "TESTACCESSKEY",
    MARKETPLACE_UPLOAD_AWS_SECRET_ACCESS_KEY: "test-secret-value",
  };
  assert.deepEqual(getMarketplaceUploadStorageConfig(complete), {
    region: "us-east-1",
    bucket: "civilon-marketplace-test",
    accessKeyId: "TESTACCESSKEY",
    secretAccessKey: "test-secret-value",
  });

  // A Price Check bucket in the environment configures nothing here: unset
  // marketplace variables mean uploads are unavailable, not that evidence goes
  // into a bucket approved for another workload.
  const priceCheckOnly = {
    PRICE_CHECK_UPLOAD_AWS_REGION: "us-east-1",
    PRICE_CHECK_UPLOAD_BUCKET: "price-check-bucket",
    AWS_REGION: "us-west-2",
  };
  assert.equal(isMarketplaceUploadStorageConfigured(priceCheckOnly), false);
  assert.throws(() => getMarketplaceUploadStorageConfig(priceCheckOnly), /UNCONFIGURED/);
  assert.equal(isMarketplaceUploadStorageConfigured({}), false);

  const partial = { ...complete };
  delete partial.MARKETPLACE_UPLOAD_AWS_SECRET_ACCESS_KEY;
  assert.throws(() => getMarketplaceUploadStorageConfig(partial), /CREDENTIALS_INCOMPLETE/);
  assert.equal(names.length, 4);
});

test("only the Sell aggregate may open an upload session today", () => {
  assert.equal(isSupportedUploadAggregate("sell_submission"), true);
  assert.equal(isSupportedUploadAggregate("buy_request"), false, "Buy evidence is a later slice");
  assert.equal(isSupportedUploadAggregate("price_check"), false);
  assert.equal(isSupportedUploadAggregate(undefined), false);
});

/* -------------------------------------------------- sell contract handshake */

test("the Sell intake accepts attachmentHandles and nothing else upload-shaped", () => {
  const accepted = validateSellSubmission(sellPayload({ attachmentHandles: [HANDLE] }));
  assert.equal(accepted.success, true, JSON.stringify(accepted.fieldErrors));
  assert.deepEqual(accepted.data.attachmentHandles, [HANDLE]);

  // Uploads are optional: absent, null and empty all submit cleanly.
  for (const value of [undefined, null, []]) {
    const result = validateSellSubmission(sellPayload({ attachmentHandles: value }));
    assert.equal(result.success, true, JSON.stringify(result.fieldErrors));
    assert.deepEqual(result.data.attachmentHandles, []);
  }

  // Every other upload-shaped name is still refused, and the allowlisted field
  // is deliberately absent from the reserved list.
  assert.equal(sellSubmissionReservedUploadFields.includes("attachmentHandles"), false);
  for (const field of sellSubmissionReservedUploadFields) {
    const result = validateSellSubmission(sellPayload({ [field]: "handle" }));
    assert.equal(result.success, false, field);
    assert.match(result.fieldErrors.uploads, /Attachments cannot be submitted yet/, field);
  }
});

test("handle lists are bounded, deduplicated and shape-checked", () => {
  const many = Array.from({ length: MARKETPLACE_UPLOAD_MAX_FILES }, (_, index) =>
    `01M06PHA5E7P10AD00000000${String(index).padStart(2, "0")}`);
  assert.equal(validateSellSubmission(sellPayload({ attachmentHandles: many })).success, true);

  const tooMany = [...many, "01M06PHA5E7P10AD0000000099"];
  const overflow = validateSellSubmission(sellPayload({ attachmentHandles: tooMany }));
  assert.equal(overflow.success, false);
  assert.ok(overflow.fieldErrors.attachmentHandles);

  for (const bad of [
    [HANDLE, HANDLE],
    ["../../object-key"],
    ["marketplace/quarantine/sell_submission/abc"],
    [HANDLE.toLowerCase()],
    [42],
    [null],
    HANDLE,
    { 0: HANDLE },
  ]) {
    const result = validateSellSubmission(sellPayload({ attachmentHandles: bad }));
    assert.equal(result.success, false, JSON.stringify(bad));
    assert.ok(result.fieldErrors.attachmentHandles, JSON.stringify(bad));
  }
});

test("a bad handle list never blocks the rest of a submission from validating", () => {
  // Attachments are optional, so a handle problem must be a field error on the
  // attachments — not a reason to reject an otherwise complete offer wholesale.
  const result = validateSellSubmission(sellPayload({ attachmentHandles: ["nope"] }));
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(result.fieldErrors), ["attachmentHandles"]);
});

/* ------------------------------------------------------------- source scans */

function source(path) {
  return readFileSync(
    new URL(`../${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
    "utf8",
  );
}

const UPLOAD_MODULES = [
  "lib/marketplace/uploads/constants.ts",
  "lib/marketplace/uploads/config.ts",
  "lib/marketplace/uploads/session.ts",
  "lib/marketplace/uploads/file-validation.ts",
  "lib/marketplace/uploads/authorization.ts",
  "lib/marketplace/uploads/binding.ts",
  "lib/marketplace/uploads/scan.ts",
  "db/price-check/repositories/marketplace-upload-repository.ts",
];

test("no marketplace upload module touches a Price Check upload table, cookie or prefix", () => {
  for (const path of UPLOAD_MODULES) {
    const text = source(path);
    for (const forbidden of [
      /\bpendingUploads\b/,
      /\buploadSessions\b/,
      /\battachments\b(?!\.)/,
      /__Host-cvlon_pc_upload/,
      /PRICE_CHECK_UPLOAD_/,
      /price-check\/uploads/,
    ]) {
      assert.equal(forbidden.test(text), false, `${path} must not reference ${forbidden}`);
    }
  }
  // And every object this pipeline names lives under the marketplace prefix.
  assert.equal(MARKETPLACE_OBJECT_PREFIX, "marketplace/");
  assert.ok(MARKETPLACE_QUARANTINE_PREFIX.startsWith(MARKETPLACE_OBJECT_PREFIX));
  assert.ok(source("lib/marketplace/uploads/authorization.ts").includes("MARKETPLACE_QUARANTINE_PREFIX"));
});

test("no camera, geolocation, video, AI or spreadsheet parsing is present", () => {
  const text = [
    ...UPLOAD_MODULES,
    "app/api/marketplace/uploads/authorize/route.ts",
    "app/api/marketplace/sell-submissions/route.ts",
    "lib/marketplace/sell-validation.ts",
  ].map(source).join("\n");
  for (const forbidden of [
    /getUserMedia|capture=|MediaDevices/i,
    /geolocation|navigator\.geo|latitude|longitude|\bGPS\b/i,
    /video\//i,
    /OpenAI|chat completion|responses API|\bOCR\b/i,
    /xlsx-parse|SheetJS|read_?workbook|parseSpreadsheet|exceljs/i,
  ]) {
    assert.equal(forbidden.test(text), false, `must not reference ${forbidden}`);
  }
  // The verifier reads archive structure, never cells: no decompression
  // library is imported or called anywhere in it.
  const validation = source("lib/marketplace/uploads/file-validation.ts");
  for (const forbidden of [
    /require\(|from ["'](node:)?zlib/,
    /inflate(Sync|Raw|\()/i,
    /yauzl|adm-zip|jszip|unzipper/i,
    /createReadStream/,
  ]) {
    assert.equal(forbidden.test(validation), false, String(forbidden));
  }
});

test("the marketplace bucket template keeps objects private, scanned and namespaced", () => {
  const template = source("infra/marketplace-uploads-preview.yaml");
  for (const control of [
    "BlockPublicAcls: true",
    "BlockPublicPolicy: true",
    "IgnorePublicAcls: true",
    "RestrictPublicBuckets: true",
    "SSEAlgorithm: AES256",
    "aws:SecureTransport",
    "GuardDutyMalwareScanStatus",
    "marketplace/quarantine/",
    "NoReadUnlessGuardDutyTaggedClean",
    "DenyWritesOutsideMarketplaceNamespace",
  ]) {
    assert.ok(template.includes(control), `template must enforce ${control}`);
  }
  // No public grant and no bucket-wide wildcard allow anywhere in the template.
  assert.doesNotMatch(template, /Effect: Allow[\s\S]{0,120}Action: s3:\*/);
  assert.doesNotMatch(template, /AllowedOrigins:\s*\n\s*-\s*["']?\*/);
  assert.doesNotMatch(template, /"?PublicRead"?|public-read/);
});

/**
 * The application writes every marketplace object under one prefix and never
 * moves or retags it once a Sell Submission claims it, so no lifecycle rule can
 * distinguish an abandoned upload from bound evidence. Any object expiration in
 * this template would therefore delete a supplier's file while the database
 * still records the attachment as present and clean.
 */
test("the marketplace template expires no evidence object and claims no exemption it cannot enforce", () => {
  const template = source("infra/marketplace-uploads-preview.yaml");

  // Every S3 lifecycle mechanism that can remove a stored object.
  for (const expiry of [
    /ExpirationInDays:/,
    /ExpirationDate:/,
    /^\s*Expiration:/m,
    /ExpiredObjectDeleteMarker:/,
    /NoncurrentVersionExpiration:/,
    /NoncurrentVersionExpirationInDays:/,
  ]) {
    assert.equal(expiry.test(template), false, `template must not expire objects via ${expiry}`);
  }

  // The removed knob must not come back, in the template or in its prose.
  assert.equal(template.includes("QuarantineExpiryDays"), false);
  assert.equal(template.includes("DeleteAbandonedMarketplaceQuarantine"), false);

  // No rule may claim to spare claimed or bound evidence: a prefix-and-tag rule
  // cannot see that distinction, so stating it would be a false assurance.
  assert.equal(
    /(claimed|bound) evidence is not (aged out|expired|deleted)/i.test(template),
    false,
    "the template must not claim a lifecycle rule spares claimed evidence",
  );

  // Aborting a never-completed multipart upload removes nothing that was ever
  // stored, so it is the one rule that stays.
  assert.ok(template.includes("AbortIncompleteMarketplaceMultipartUploads"));
  assert.ok(template.includes("AbortIncompleteMultipartUpload:"));

  // Retention and privacy controls are untouched by the lifecycle change.
  for (const control of [
    "DeletionPolicy: Retain",
    "UpdateReplacePolicy: Retain",
    "BlockPublicPolicy: true",
    "MalwareProtectionPlan",
  ]) {
    assert.ok(template.includes(control), `template must still carry ${control}`);
  }
});

test("no secret reaches the browser and no upload field reaches analytics", () => {
  const route = source("app/api/marketplace/uploads/authorize/route.ts");
  for (const forbidden of [
    /secretAccessKey/,
    /MARKETPLACE_UPLOAD_SESSION_KEY/,
    /MARKETPLACE_UPLOAD_AWS/,
    /tokenHash/,
    /objectKey/,
  ]) {
    assert.equal(forbidden.test(route), false, `the authorize response must not carry ${forbidden}`);
  }
  // The session token leaves only as a Set-Cookie, never in a JSON body.
  assert.ok(route.includes("marketplaceUploadSessionCookie(authorized.token)"));
  assert.equal(/token: authorized\.token|token:\s*authorized/.test(route), false);

  // Analytics carries Price Check's own two upload milestones and nothing
  // marketplace-shaped: no filename, no handle, no key, no purpose, and no
  // event that would let a supplier's evidence show up in a page-view stream.
  const analytics = source("lib/analytics.ts");
  // Sell milestone event *names* are allowed — they are page-level facts. What
  // must never appear is anything describing a file or its contents.
  for (const forbidden of [/filename/i, /attachment/i, /objectKey/i, /purpose/i, /handle/i]) {
    assert.equal(forbidden.test(analytics), false, `analytics must not carry ${forbidden}`);
  }
  // The context type stays a closed two-key allowlist, so no caller can widen it.
  assert.ok(analytics.includes("source_page?: string;"));
  assert.ok(analytics.includes("cta_location?: string;"));
  assert.equal(/\.\.\.context\b/.test(analytics), false, "the payload builder copies no rest");
  // And nothing in the marketplace upload path emits an analytics event at all.
  for (const path of [...UPLOAD_MODULES, "app/api/marketplace/uploads/authorize/route.ts"]) {
    assert.equal(/analytics|trackEvent|dataLayer|gtag/i.test(source(path)), false, path);
  }
});

/* ------------------------------------------------- authorize route contract */

test("the authorize route is gated on both flags and refuses every non-POST method", () => {
  const route = source("app/api/marketplace/uploads/authorize/route.ts");

  // Both marketplace and Sell must be on. isSellSubmissionEnabled is the
  // conjunction, so uploads cannot be reached by enabling Price Check or the
  // marketplace alone.
  assert.ok(route.includes("isSellSubmissionEnabled()"));
  assert.equal(/isPriceCheckEnabled|NEXT_PUBLIC_PRICE_CHECK/.test(route), false);
  assert.match(route, /if \(!isSellSubmissionEnabled\(\)\) return response\([^;]*404/);

  // Nothing here is readable, and no method other than POST mutates.
  assert.ok(route.includes("export async function POST"));
  assert.ok(route.includes("export function GET"));
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.ok(route.includes(`export const ${method} = GET`), method);
  }
  assert.ok(route.includes("405"));
  assert.ok(route.includes('Allow: "POST"'));
});

test("the authorize route requires a same-host https Origin and rate-limits by network", () => {
  const route = source("app/api/marketplace/uploads/authorize/route.ts");

  // Stricter than the intake routes: a missing Origin is refused outright,
  // because authorizing an upload mints a credential that writes to storage.
  assert.ok(route.includes("if (!origin) return false;"));
  assert.ok(route.includes("originUrl.host !== requestUrl.host"));
  assert.ok(route.includes('originUrl.protocol !== "https:"'));
  assert.ok(route.includes('fetchSite === "same-origin"'));
  assert.ok(route.includes("isApprovedSubmissionHost"));
  assert.match(route, /verifyOrigin\(request\)[\s\S]{0,160}403/);

  // Its own limiter, not the intake one and not Price Check's.
  assert.ok(route.includes("consumeMarketplaceUploadAuthorization"));
  assert.equal(/consumeUploadAuthorization|consumeMarketplaceAttempt\b/.test(route), false);
  assert.match(route, /429[\s\S]{0,160}Retry-After/);
  assert.ok(route.includes("startsWith(\"application/json\")"));
  assert.ok(route.includes("415"));
});

test("the authorize route answers privately and never leaks an internal failure", () => {
  const route = source("app/api/marketplace/uploads/authorize/route.ts");
  for (const header of ["private, no-store, max-age=0", "noindex, nofollow, noarchive", "no-referrer"]) {
    assert.ok(route.includes(header), header);
  }
  // A storage misconfiguration, a missing session key or a database fault all
  // collapse to one generic answer; only the seller's own input is echoed.
  assert.ok(route.includes("File uploads are temporarily unavailable"));
  assert.ok(route.includes("MARKETPLACE_UPLOAD_AUTHORIZE_FAILED"));
  // The generic branch logs an error name only — no message, key or filename.
  assert.match(route, /event: "MARKETPLACE_UPLOAD_AUTHORIZE_FAILED",\s*\n\s*errorName:/);
  const logged = route.slice(route.indexOf("console.error"), route.indexOf("console.error") + 300);
  for (const forbidden of [/message/i, /filename/i, /objectKey/i, /handle/i]) {
    assert.equal(forbidden.test(logged), false, `the log line must not carry ${forbidden}`);
  }
});

test("the marketplace upload limiter is independent of every other limiter", async () => {
  const {
    consumeMarketplaceUploadAuthorization,
    marketplaceUploadRateLimitKey,
    resetMarketplaceUploadRateLimitForTests,
  } = await import("../lib/marketplace/uploads/rate-limit.ts");
  const {
    consumeMarketplaceAttempt,
    marketplaceRateLimitKey,
    resetMarketplaceRateLimitForTests,
  } = await import("../lib/marketplace/rate-limit.ts");

  resetMarketplaceUploadRateLimitForTests();
  resetMarketplaceRateLimitForTests();
  const key = marketplaceUploadRateLimitKey("203.0.113.9");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes("203.0.113.9"), false, "the client address is never stored raw");

  // A whole 12-file session fits, with headroom for retries, then closes.
  for (let attempt = 0; attempt < MARKETPLACE_UPLOAD_MAX_FILES * 2; attempt += 1) {
    assert.equal(consumeMarketplaceUploadAuthorization(key).allowed, true, `attempt ${attempt}`);
  }
  const blocked = consumeMarketplaceUploadAuthorization(key);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  // Exhausting uploads must not stop the seller submitting the offer itself.
  assert.equal(consumeMarketplaceAttempt(marketplaceRateLimitKey("203.0.113.9")).allowed, true);
  // And the window does eventually reopen.
  assert.equal(consumeMarketplaceUploadAuthorization(key, Date.now() + 11 * 60 * 1000).allowed, true);
  resetMarketplaceUploadRateLimitForTests();
  resetMarketplaceRateLimitForTests();
});

test("the Sell intake route reads the session from a cookie and never from the body", () => {
  const route = source("app/api/marketplace/sell-submissions/route.ts");
  assert.ok(route.includes("readMarketplaceUploadCookie(request.headers.get("));
  assert.ok(route.includes("uploadSessionToken:"));
  // A client cannot name a session: no body field is ever read as one.
  assert.equal(/validation\.data\.uploadSessionToken|raw\.uploadSessionToken|body\.token/.test(route), false);

  // Missing or pending scan evidence is a retry, not a claim and not a refusal.
  assert.ok(route.includes("isRetryableScanCode"));
  assert.match(route, /isRetryableScanCode[\s\S]{0,500}409[\s\S]{0,120}Retry-After/);
  assert.ok(route.includes("still being checked"));
  // A dirty verdict is a refusal, and is never reported as retryable.
  assert.match(route, /MARKETPLACE_SCAN_REJECTED_CODE[\s\S]{0,400}400/);
});

test("no filename, key or file content can reach an email or an audit row", () => {
  const templates = source("lib/marketplace/email/sell-submission-templates.ts");
  const handlers = source("lib/marketplace/email/sell-submission-handlers.ts");
  for (const forbidden of [/filename/i, /attachment/i, /objectKey/i, /byteSize/i, /declaredMime/i]) {
    assert.equal(forbidden.test(templates), false, `templates must not carry ${forbidden}`);
    assert.equal(forbidden.test(handlers), false, `handlers must not carry ${forbidden}`);
  }
  // The repository records that evidence exists, never what it is called.
  const repository = source("db/price-check/repositories/sell-submission-repository.ts");
  const auditBlock = repository.slice(repository.indexOf("SELL_SUBMISSION_ATTACHMENT_BOUND"));
  assert.equal(
    /displayFilename/.test(auditBlock.slice(0, 600)),
    false,
    "audit metadata must not carry the filename",
  );
  assert.ok(auditBlock.includes("attachmentId"));

  // The intake route logs an error shape only.
  const route = source("app/api/marketplace/sell-submissions/route.ts");
  const logged = route.slice(route.indexOf("console.error"), route.indexOf("console.error") + 400);
  for (const forbidden of [/filename/i, /handle/i, /objectKey/i, /businessEmail/i, /reference/i]) {
    assert.equal(forbidden.test(logged), false, `the log line must not carry ${forbidden}`);
  }
});

test("scan evidence is required before any byte of an object is read", () => {
  const binding = source("lib/marketplace/uploads/binding.ts");
  const tagIndex = binding.indexOf("GetObjectTaggingCommand({");
  const headIndex = binding.indexOf("HeadObjectCommand({");
  assert.ok(tagIndex > 0 && headIndex > 0);
  assert.ok(tagIndex < headIndex, "tags are read before object metadata");

  // Every non-clean verdict throws before the HeadObject call is reached.
  const beforeHead = binding.slice(tagIndex, headIndex);
  for (const guard of [
    'if (decision === "PENDING") throw',
    'if (decision === "FAILED") throw',
    'if (decision !== "CLEAN") throw',
  ]) {
    assert.ok(beforeHead.includes(guard), guard);
  }
  // A tag call that fails at all is unavailable, never clean.
  assert.match(binding, /catch \{[\s\S]{0,240}MARKETPLACE_SCAN_UNAVAILABLE_CODE/);
  // Content is read by bounded range, never as a whole object.
  assert.ok(binding.includes("Range: range"));
  assert.ok(binding.includes("MARKETPLACE_SIGNATURE_HEAD_BYTES"));
  assert.ok(binding.includes("MARKETPLACE_SIGNATURE_TAIL_BYTES"));
  // The stored content type must match; there is no "absent means fine" path.
  assert.ok(binding.includes("head.ContentType !== item.declaredMime"));
  assert.equal(/typeof head\.ContentType === "string" &&/.test(binding), false);
});
