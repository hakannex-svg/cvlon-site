import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import {
  sanitizeUploadFilename,
  validateUploadDeclaration,
  validateUploadedFile,
} from "../lib/price-check/uploads/file-validation.ts";
import {
  hashUploadSessionToken,
  newUploadSessionToken,
  uploadSessionCookie,
} from "../lib/price-check/uploads/session.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";
import { validatePriceCheckSubmission } from "../lib/price-check/validation.ts";
import { guardDutyScanDecision } from "../lib/price-check/uploads/reconciliation.ts";
import { getUploadStorageConfig } from "../lib/price-check/uploads/config.ts";

function validSubmission(overrides = {}) {
  return {
    idempotencyKey: "1d9e9181-3b1e-49d7-8a61-28a8e230fd09",
    partNumber: "TEST-PHASE7-001", quantity: "1", quoteOrPurchased: "quote",
    transactionType: "outright", conditionCode: "SV", unitPrice: "1250.00",
    currencyCode: "USD", aog: false, description: "", aircraftModel: "",
    coreCharge: "", coreDisposition: "", exchangeFee: "", freight: "",
    transactionDate: "", warrantyValue: "", warrantyUnit: "", warrantyText: "",
    documentationCodes: [], documentationOther: "", attachmentHandles: [], notes: "",
    firstName: "Synthetic", lastName: "Requester", companyName: "Example Aviation",
    businessEmail: "phase7@example.com", phone: "", role: "Buyer", country: "US",
    serviceAcknowledged: true, sourcePage: "/price-check", landingPage: null,
    referrer: null, utmSource: null, utmMedium: null, utmCampaign: null,
    utmContent: null, utmTerm: null, website: "", ...overrides,
  };
}

test("upload declarations enforce the four allowed formats, extension, and 10 MB cap", () => {
  assert.deepEqual(validateUploadDeclaration({ filename: "quote.pdf", mime: "application/pdf", size: 1024 }), {
    filename: "quote.pdf", mime: "application/pdf", size: 1024,
  });
  assert.equal(sanitizeUploadFilename("C:\\fakepath\\invoice.png"), "invoice.png");
  assert.throws(() => validateUploadDeclaration({ filename: "quote.jpg", mime: "application/pdf", size: 10 }), /extension/);
  assert.throws(() => validateUploadDeclaration({ filename: "quote.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 }), /PDF/);
  assert.throws(() => validateUploadDeclaration({ filename: "quote.pdf", mime: "application/pdf", size: 10 * 1024 * 1024 + 1 }), /10 MB/);
});

test("server-side validation detects content, rejects MIME spoofing and encrypted PDFs", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n%%EOF\n", "latin1");
  const valid = validateUploadedFile(pdf, "application/pdf");
  assert.equal(valid.detectedMime, "application/pdf");
  assert.match(valid.contentDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => validateUploadedFile(pdf, "image/png"), /does not match/);
  const encrypted = Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page /Encrypt 2 0 R>>endobj\n%%EOF\n", "latin1");
  assert.throws(() => validateUploadedFile(encrypted, "application/pdf"), /Password-protected/);
  const malformed = Buffer.from("%PDF-1.7\n/Type /Page", "latin1");
  assert.throws(() => validateUploadedFile(malformed, "application/pdf"), /incomplete/);
});

test("JPEG, PNG and WebP signatures and image dimensions are verified", () => {
  const png = Buffer.alloc(45);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8); png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20); png.write("IEND", 37, "ascii");
  assert.equal(validateUploadedFile(png, "image/png").detectedMime, "image/png");
  const oversizedPng = Buffer.from(png); oversizedPng.writeUInt32BE(12001, 16);
  assert.throws(() => validateUploadedFile(oversizedPng, "image/png"), /too large/);

  const jpeg = Buffer.alloc(23);
  Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x02,0x58,0x03,0x20]).copy(jpeg, 0);
  jpeg[21] = 0xff; jpeg[22] = 0xd9;
  assert.equal(validateUploadedFile(jpeg, "image/jpeg").detectedMime, "image/jpeg");

  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii"); webp.writeUInt32LE(22, 4); webp.write("WEBP", 8, "ascii");
  webp.write("VP8X", 12, "ascii"); webp[24] = 0x1f; webp[27] = 0x1f;
  assert.equal(validateUploadedFile(webp, "image/webp").detectedMime, "image/webp");
});

test("upload session is opaque and the browser cookie is host-only, secure, HttpOnly and SameSite", () => {
  const token = newUploadSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{64}$/);
  assert.match(hashUploadSessionToken(token), /^[a-f0-9]{64}$/);
  const cookie = uploadSessionCookie(token);
  assert.match(cookie, /^__Host-cvlon_pc_upload=/);
  for (const flag of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) assert.match(cookie, new RegExp(flag));
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("submission contract accepts up to three opaque handles and rejects duplicates or forgeries", () => {
  const handles = ["01M06PHA5E7P10AD0000000001", "01M06PHA5E7P10AD0000000002"];
  assert.equal(validatePriceCheckSubmission(validSubmission({ attachmentHandles: handles })).success, true);
  assert.equal(validatePriceCheckSubmission(validSubmission({ attachmentHandles: [handles[0], handles[0]] })).success, false);
  assert.equal(validatePriceCheckSubmission(validSubmission({ attachmentHandles: ["../../object-key"] })).success, false);
});

test("staff download RBAC excludes auditors and reconciliation remains admin-only", () => {
  assert.equal(roleCan("ANALYST", "download_attachment"), true);
  assert.equal(roleCan("REVIEWER", "download_attachment"), true);
  assert.equal(roleCan("ADMIN", "download_attachment"), true);
  assert.equal(roleCan("AUDITOR", "download_attachment"), false);
  assert.equal(roleCan("ADMIN", "reconcile_attachment"), true);
  assert.equal(roleCan("REVIEWER", "reconcile_attachment"), false);
});

test("GuardDuty scan decisions fail closed", () => {
  assert.equal(guardDutyScanDecision("NO_THREATS_FOUND"), "CLEAN");
  assert.equal(guardDutyScanDecision("THREATS_FOUND"), "REJECTED");
  for (const status of [undefined, "UNSUPPORTED", "ACCESS_DENIED", "FAILED", "UNKNOWN"]) {
    assert.notEqual(guardDutyScanDecision(status), "CLEAN");
  }
});

test("upload storage accepts Netlify-safe server credentials and rejects partial configuration", () => {
  const names = [
    "PRICE_CHECK_UPLOAD_AWS_REGION",
    "PRICE_CHECK_UPLOAD_AWS_ACCESS_KEY_ID",
    "PRICE_CHECK_UPLOAD_AWS_SECRET_ACCESS_KEY",
    "PRICE_CHECK_UPLOAD_BUCKET",
    "AWS_REGION",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.PRICE_CHECK_UPLOAD_AWS_REGION = "us-east-1";
    process.env.PRICE_CHECK_UPLOAD_AWS_ACCESS_KEY_ID = "TESTACCESSKEY";
    process.env.PRICE_CHECK_UPLOAD_AWS_SECRET_ACCESS_KEY = "test-secret-value";
    process.env.PRICE_CHECK_UPLOAD_BUCKET = "phase7-test-bucket";
    process.env.AWS_REGION = "us-west-2";
    assert.deepEqual(getUploadStorageConfig(), {
      region: "us-east-1",
      bucket: "phase7-test-bucket",
      accessKeyId: "TESTACCESSKEY",
      secretAccessKey: "test-secret-value",
    });

    delete process.env.PRICE_CHECK_UPLOAD_AWS_SECRET_ACCESS_KEY;
    assert.throws(() => getUploadStorageConfig(), /credentials are incomplete/);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("infrastructure and application enforce private quarantine without OpenAI", () => {
  const template = fs.readFileSync(new URL("../infra/price-check-phase-7-preview.yaml", import.meta.url), "utf8");
  for (const control of ["BlockPublicAcls: true", "RestrictPublicBuckets: true", "SSEAlgorithm: AES256", "aws:SecureTransport", "GuardDutyMalwareScanStatus", "quarantine/", "DeleteAbandonedQuarantine"]) assert.match(template, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(template, /Effect: Allow[\s\S]{0,80}Action: s3:\*/);
  const phase7Files = [
    "../lib/price-check/uploads/authorization.ts",
    "../lib/price-check/uploads/reconciliation.ts",
    "../components/PriceCheckForm.tsx",
  ].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(phase7Files, /OpenAI|OCR|chat completion|responses API/i);
  const publicPage = fs.readFileSync(new URL("../app/price-check/page.tsx", import.meta.url), "utf8");
  assert.match(publicPage, /Optional private supporting-document upload/);
  assert.doesNotMatch(publicPage, /No document upload in this phase/);
  const authorizeRoute = fs.readFileSync(new URL("../app/api/price-check/uploads/authorize/route.ts", import.meta.url), "utf8");
  assert.match(authorizeRoute, /document type\|PDF\|JPG\|PNG\|WebP/);
  const binding = fs.readFileSync(new URL("../lib/price-check/uploads/binding.ts", import.meta.url), "utf8");
  assert.match(binding, /GetObjectAttributesCommand/);
  assert.doesNotMatch(binding, /HeadObjectCommand|GetObjectCommand/);
});
