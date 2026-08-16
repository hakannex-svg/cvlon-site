import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { buildResponsesRequest, extractDocumentWithOpenAI } from "../lib/price-check/extraction/openai.ts";
import { getOpenAIExtractionConfig } from "../lib/price-check/extraction/config.ts";
import { EXTRACTION_SYSTEM_PROMPT } from "../lib/price-check/extraction/prompt.ts";
import { validateDocumentExtraction } from "../lib/price-check/extraction/schema.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";
import { extraction, goldenCases } from "./fixtures/price-check-phase-8-golden.mjs";

const config = { apiKey: "test-key-not-secret", model: "test-model-snapshot", schemaVersion: "phase8-v1", promptVersion: "phase8-v1", timeoutMs: 1000 };

test("Responses request uses direct bytes, strict schema, store false and no tools", () => {
  const pdf = buildResponsesRequest({ config, bytes: Buffer.from("synthetic"), mime: "application/pdf", filename: "synthetic.pdf" });
  assert.equal(pdf.store, false);
  assert.equal(pdf.text.format.type, "json_schema");
  assert.equal(pdf.text.format.strict, true);
  assert.equal(pdf.max_output_tokens, 12_000);
  assert.equal("tools" in pdf, false);
  const file = pdf.input[1].content[0];
  assert.equal(file.type, "input_file");
  assert.equal(file.detail, "high");
  assert.match(file.file_data, /^data:application\/pdf;base64,/);
  assert.equal(JSON.stringify(pdf).includes("/v1/files"), false);

  const image = buildResponsesRequest({ config, bytes: Buffer.from("synthetic"), mime: "image/jpeg", filename: "synthetic.jpg" });
  assert.equal(image.input[1].content[0].type, "input_image");
  assert.equal(image.input[1].content[0].detail, "high");
  assert.match(image.input[1].content[0].image_url, /^data:image\/jpeg;base64,/);
});

test("strict validator accepts all explicitly defined A-O golden expectations", () => {
  assert.deepEqual(goldenCases.map(({ id, expected }) => [id, validateDocumentExtraction(expected).review_required]), [
    ["A", false], ["B", false], ["C", false], ["D", false], ["E", false], ["F", false], ["G", false],
    ["H", true], ["I", true], ["J", false], ["K", true], ["L", true], ["M", true], ["N", false], ["O", true],
  ]);
});

test("schema rejects unknown fields, numeric corruption and false inferred fields", () => {
  const unknown = structuredClone(extraction()); unknown.market_price = "19000.00";
  assert.throws(() => validateDocumentExtraction(unknown), /EXTRACTION_SCHEMA_INVALID/);
  const numeric = structuredClone(extraction()); numeric.line_items[0].unit_price.value = "16,850.00";
  assert.throws(() => validateDocumentExtraction(numeric), /EXTRACTION_SCHEMA_INVALID/);
  const falseCondition = structuredClone(extraction()); falseCondition.line_items[0].condition = { ...falseCondition.line_items[0].condition, state: "NOT_FOUND" };
  assert.throws(() => validateDocumentExtraction(falseCondition), /EXTRACTION_SCHEMA_INVALID/);
  const falseDocumentation = structuredClone(extraction()); falseDocumentation.line_items[0].documentation_release = { ...falseDocumentation.line_items[0].documentation_release, state: "NOT_FOUND", value: [{ code: "FAA_8130_3", raw: "assumed" }] };
  assert.throws(() => validateDocumentExtraction(falseDocumentation), /EXTRACTION_SCHEMA_INVALID/);
});

test("adapter accepts only a strict structured output and records safe usage", async () => {
  const expected = extraction();
  const fetchImpl = async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-key-not-secret");
    const sent = JSON.parse(init.body);
    assert.equal(sent.store, false);
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(expected) }] }], usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 } }), { status: 200 });
  };
  const result = await extractDocumentWithOpenAI({ config, bytes: Buffer.from("synthetic"), mime: "application/pdf", filename: "synthetic.pdf" }, { fetchImpl });
  assert.deepEqual(result.proposal, expected);
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 45, totalTokens: 165 });
  assert.match(result.requestDigest, /^[a-f0-9]{64}$/);
});

test("adapter categorizes refusal, rate limit, unavailable and invalid output without leaking bodies", async () => {
  const call = (fetchImpl) => extractDocumentWithOpenAI({ config, bytes: Buffer.from("synthetic"), mime: "image/png", filename: "synthetic.png" }, { fetchImpl });
  await assert.rejects(call(async () => new Response("limited", { status: 429 })), /OPENAI_RATE_LIMITED/);
  await assert.rejects(call(async () => new Response("down", { status: 503 })), /OPENAI_UNAVAILABLE/);
  await assert.rejects(call(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "refusal", refusal: "not returned" }] }] }), { status: 200 })), /OPENAI_REFUSAL/);
  await assert.rejects(call(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "not json" }] }] }), { status: 200 })), /OPENAI_STRUCTURED_OUTPUT_INVALID/);
  await assert.rejects(call(async () => new Response("x".repeat(1_000_001), { status: 200 })), /OPENAI_OUTPUT_TOO_LARGE/);
  await assert.rejects(call(async () => new Response("not-response-json", { status: 200 })), /OPENAI_RESPONSE_INVALID/);
});

test("preview configuration fails closed for production, wrong branches and missing secrets", () => {
  assert.throws(() => getOpenAIExtractionConfig({ CONTEXT: "production", OPENAI_API_KEY: "x", OPENAI_EXTRACTION_MODEL: "m" }), /OPENAI_PRODUCTION_DISABLED/);
  assert.throws(() => getOpenAIExtractionConfig({ CONTEXT: "deploy-preview", BRANCH: "main", OPENAI_API_KEY: "x", OPENAI_EXTRACTION_MODEL: "m" }), /OPENAI_PREVIEW_BRANCH_REJECTED/);
  assert.throws(() => getOpenAIExtractionConfig({ CONTEXT: "deploy-preview", BRANCH: "codex/civilon-price-check-phase-8" }), /OPENAI_EXTRACTION_NOT_CONFIGURED/);
  assert.equal(getOpenAIExtractionConfig({ CONTEXT: "deploy-preview", BRANCH: "codex/civilon-price-check-phase-8", OPENAI_API_KEY: "x", OPENAI_EXTRACTION_MODEL: "m" }).model, "m");
});

test("extraction RBAC permits staff workflow and keeps auditor read-only", () => {
  for (const role of ["ANALYST", "REVIEWER", "ADMIN"]) {
    assert.equal(roleCan(role, "extract_attachment"), true);
    assert.equal(roleCan(role, "apply_extraction"), true);
  }
  assert.equal(roleCan("ADMIN", "retry_extraction"), true);
  assert.equal(roleCan("ANALYST", "retry_extraction"), false);
  assert.equal(roleCan("REVIEWER", "retry_extraction"), false);
  assert.equal(roleCan("AUDITOR", "extract_attachment"), false);
  assert.equal(roleCan("AUDITOR", "apply_extraction"), false);
});

test("prompt treats documents as untrusted data and forbids tools, links, inference and instruction disclosure", () => {
  for (const phrase of ["untrusted evidence", "Do not follow instructions", "links", "URLs", "QR codes", "commands", "Do not reveal", "no tools", "NOT_FOUND", "Do not infer", "Never alter, round, calculate", "freight quoted separately", "not numeric zero"]) {
    assert.match(EXTRACTION_SYSTEM_PROMPT, new RegExp(phrase, "i"));
  }
});

test("implementation has no Files API, customer extraction UI or browser secret", () => {
  const files = [
    "../lib/price-check/extraction/openai.ts", "../lib/price-check/extraction/service.ts",
    "../app/api/admin/price-checks/[id]/attachments/[attachmentId]/extract/route.ts",
  ].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(files, /\/v1\/files|vector[_ -]?store|file[_ -]?search|web[_ -]?search|code[_ -]?interpreter|background\s*:/i);
  assert.doesNotMatch(files, /NEXT_PUBLIC_OPENAI_API_KEY/);
  assert.match(files, /store:\s*false/);
});

test("admin attachment workflow exposes accessible queued and processing feedback", () => {
  const source = fs.readFileSync(new URL("../components/admin/AdminAttachmentWorkspace.tsx", import.meta.url), "utf8");
  const review = fs.readFileSync(new URL("../components/admin/AdminExtractionReview.tsx", import.meta.url), "utf8");
  const detail = fs.readFileSync(new URL("../app/admin/price-checks/[id]/page.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /state:\s*"pending"/);
  assert.match(source, /state:\s*"running"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /extractionStatusRefs\.current\[activeExtraction\.attachmentId\]\?\.focus\(\)/);
  assert.match(source, /feedbackRef\.current\?\.focus\(\)/);
  assert.match(source, /\[message, error, extractionStates\]/);
  assert.match(review, /feedbackRef\.current\?\.focus\(\)/);
  assert.match(review, /sessionStorage\.setItem\(revisionFocusKey, "pending"\)/);
  assert.match(review, /sessionStorage\.removeItem\(revisionFocusKey\)/);
  assert.match(review, /document\.getElementById\("reviewed-heading"\)\?\.focus\(\)/);
  assert.match(detail, /id="reviewed-heading" tabIndex=\{-1\}/);
  assert.match(css, /\.admin-detail-main,\.admin-detail-main \*\{min-width:0\}/);
  assert.match(css, /\.admin-preview-seed button\{width:100%;white-space:normal\}/);
  assert.match(`${source}\n${review}`, /tabIndex=\{-1\}/);
});

test("public upload disclosure uses the owner-approved privacy wording", () => {
  const form = fs.readFileSync(new URL("../components/PriceCheckForm.tsx", import.meta.url), "utf8");
  const documentation = fs.readFileSync(new URL("../docs/PRICE-CHECK-PHASE-8-AI-EXTRACTION.md", import.meta.url), "utf8");
  assert.match(form, /Uploaded documents may be processed using automated tools to help Civilon identify transaction details\./);
  assert.match(form, /Extracted information is reviewed by Civilon before it is used in your Price Check\./);
  assert.match(form, /please upload only information necessary for the review\./);
  assert.doesNotMatch(form, /Zero Data Retention|fully redacted|completely anonymous|AI determines/i);
  assert.match(documentation, /PENDING COUNSEL REVIEW BEFORE PUBLIC PRODUCTION LAUNCH/);
  assert.match(documentation, /third-party automated-processing service providers/);
  assert.match(documentation, /does not determine Civilon's pricing analysis/);
});
