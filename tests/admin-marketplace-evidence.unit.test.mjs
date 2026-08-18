import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  EVIDENCE_DOWNLOAD_EXPIRY_SECONDS,
  evidenceContentDisposition,
  safeEvidenceContentType,
  safeEvidenceFilename,
} from "../lib/marketplace/admin/evidence-download.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const route = read("app", "api", "admin", "marketplace", "sell-submissions", "[id]", "attachments", "[attachmentId]", "download", "route.ts");
const service = read("lib", "marketplace", "admin", "evidence-download.ts");
const evidenceRepo = read("db", "price-check", "repositories", "marketplace-evidence-repository.ts");
const detailRepo = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");

/* --------------------------------------------------------------- capability */

test("only staff with download_marketplace_evidence may reach the route", () => {
  assert.match(route, /requireStaffApi\("download_marketplace_evidence"\)/);
  assert.doesNotMatch(route, /requireAdminApi/);
  assert.match(route, /if \(access\.status !== "authorized"\) return withPrivacyHeaders\(accessErrorResponse\(access\.status\)\)/);
  // AUDITOR is denied by policy, not by a route-level special case.
  assert.equal(roleCan("AUDITOR", "download_marketplace_evidence"), false);
  assert.equal(roleCan("AUDITOR", "view_marketplace"), true);
  for (const role of ["ANALYST", "REVIEWER", "ADMIN"]) {
    assert.equal(roleCan(role, "download_marketplace_evidence"), true);
  }
});

test("the route is node runtime and GET only", () => {
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export async function GET\(/);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.match(route, new RegExp(`export const ${method} = methodNotAllowed;`), `${method} must be refused`);
  }
  assert.match(route, /headers\.set\("Allow", "GET"\)/);
  assert.match(route, /privateJson\(\{ ok: false, error: "Method not allowed\." \}, 405\)/);
});

/* ------------------------------------------------------------------ headers */

test("every response carries the full private header set", () => {
  assert.match(route, /headers\.set\("Cache-Control", "private, no-store, max-age=0"\)/);
  assert.match(route, /headers\.set\("X-Robots-Tag", "noindex, nofollow, noarchive"\)/);
  assert.match(route, /headers\.set\("Referrer-Policy", "no-referrer"\)/);
  assert.match(route, /headers\.set\("Vary", "Cookie"\)/);
  // Every response the route emits goes through the wrapper, including the 303
  // and the catch. Scoped past the wrapper's own body, which returns raw.
  const emitting = route.slice(route.indexOf("export async function GET("));
  const returns = emitting.match(/return (?!withPrivacyHeaders)[^;]*;/g) ?? [];
  const offenders = returns.filter(line => !line.includes("new Response(withHeaders.body"));
  assert.deepEqual(offenders, [], `every response must be wrapped: ${offenders.join(" | ")}`);
  // access error, malformed id, not_found, not_clean, unavailable, 303, catch.
  assert.equal((emitting.match(/return withPrivacyHeaders\(/g) ?? []).length, 7);
});

/* ---------------------------------------------------------- parent binding */

test("the lookup predicate binds the parent as well as the attachment", () => {
  assert.match(evidenceRepo, /eq\(marketplaceAttachments\.id, attachmentId\)/);
  assert.match(evidenceRepo, /eq\(marketplaceAttachments\.sellSubmissionId, sellSubmissionId\)/);
  assert.match(evidenceRepo, /eq\(marketplaceAttachments\.aggregateType, SELL_SUBMISSION_AGGREGATE_TYPE\)/);
  assert.match(evidenceRepo, /eq\(marketplaceAttachments\.aggregateId, sellSubmissionId\)/);
  assert.match(evidenceRepo, /isNull\(marketplaceAttachments\.deletedAt\)/);
  // Both ids are shape-checked before they are used.
  assert.match(route, /const RECORD_ID_PATTERN = \/\^\[0-9A-HJKMNP-TV-Z\]\{26\}\$\//);
  assert.match(route, /!RECORD_ID_PATTERN\.test\(id\) \|\| !RECORD_ID_PATTERN\.test\(attachmentId\)/);
});

test("the object key stays out of every detail projection and component", () => {
  for (const [name, source] of [["detail repository", detailRepo], ["SellSubmissionDetail", sellDetail]]) {
    for (const token of ["objectKey", "object_key", "storageProvider", "contentDigest", "Bucket", "bucket"]) {
      assert.doesNotMatch(source, new RegExp(`\\b${token}\\b`), `${name} must not reference ${token}`);
    }
  }
  // The key is readable in exactly one repository module, and one service.
  assert.match(evidenceRepo, /objectKey: marketplaceAttachments\.objectKey/);
  assert.match(service, /attachment\.objectKey/);
  // …and never in the route itself.
  assert.doesNotMatch(route, /objectKey|Bucket|MARKETPLACE_UPLOAD/);
});

/* ------------------------------------------------------------- scan gating */

test("the stored state is checked first, then the live GuardDuty tag", () => {
  assert.match(service, /if \(attachment\.scanState !== "CLEAN"\) return \{ outcome: "not_clean" \};/);
  assert.match(service, /liveTag = await deps\.readScanTag\(attachment\.objectKey\);/);
  assert.match(service, /if \(marketplaceScanDecision\(liveTag\) !== "CLEAN"\) return \{ outcome: "not_clean" \};/);
  assert.match(service, /GetObjectTaggingCommand/);
  assert.match(service, /MARKETPLACE_SCAN_TAG/);
  // The live re-read happens before signing, never after.
  assert.ok(
    service.indexOf("marketplaceScanDecision(liveTag)") < service.indexOf("deps.signDownload"),
    "the live tag must be re-read before anything is signed",
  );
  // A tag that cannot be read at all is unavailable, not clean.
  assert.match(service, /liveTag = await deps\.readScanTag[\s\S]{0,200}?\} catch \{[\s\S]{0,240}?return \{ outcome: "unavailable" \};/);
});

test("the route maps each outcome to a readable, diagnostic-free answer", () => {
  assert.match(route, /result\.outcome === "not_found"[\s\S]{0,180}?404/);
  assert.match(route, /result\.outcome === "not_clean"[\s\S]{0,240}?409/);
  assert.match(route, /result\.outcome === "unavailable"[\s\S]{0,180}?503/);
  assert.match(route, /Its malware scan is not clean\./);
  assert.match(route, /The secure download could not be created\./);
  // No provider diagnostic, code or stack reaches the body.
  assert.doesNotMatch(route, /error\.message|error\.name|String\(error\)|JSON\.stringify\(error\)|console\./);
  assert.match(route, /\} catch \{/);
});

/* ---------------------------------------------------------------- signing */

test("the presigned URL is short lived and never enters a response body", () => {
  assert.equal(EVIDENCE_DOWNLOAD_EXPIRY_SECONDS, 120);
  assert.ok(EVIDENCE_DOWNLOAD_EXPIRY_SECONDS <= 120);
  assert.match(service, /expiresIn: EVIDENCE_DOWNLOAD_EXPIRY_SECONDS,/);
  assert.match(service, /getSignedUrl\(client, new GetObjectCommand\(/);
  // The only place a signed URL leaves is the redirect Location.
  assert.match(route, /status: 303,\s*headers: \{ Location: result\.signedUrl \},/);
  assert.equal((route.match(/result\.signedUrl/g) ?? []).length, 1);
  assert.doesNotMatch(route, /privateJson\([^)]*signedUrl/);
});

test("the storage boundary is dependency-isolated so tests need no credential", () => {
  assert.match(service, /export type EvidenceDownloadDeps = \{/);
  assert.match(service, /export function defaultEvidenceDownloadDeps\(\): EvidenceDownloadDeps \{/);
  assert.match(service, /deps: EvidenceDownloadDeps = defaultEvidenceDownloadDeps\(\)/);
});

/* --------------------------------------------------------------- filenames */

test("the download filename cannot break the header or the filesystem", () => {
  // An ordinary name survives intact.
  assert.equal(safeEvidenceFilename("warehouse evidence.pdf"), "warehouse evidence.pdf");
  assert.equal(safeEvidenceFilename("inventory_2026-08.csv"), "inventory_2026-08.csv");
  // Empty, blank and dots-only fall back rather than yielding a bare path.
  assert.equal(safeEvidenceFilename(""), "civilon-evidence");
  assert.equal(safeEvidenceFilename("   "), "civilon-evidence");
  assert.equal(safeEvidenceFilename("..."), "_");
  assert.equal(safeEvidenceFilename("a".repeat(400)).length, 160);

  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const RTL_OVERRIDE = String.fromCharCode(0x202e);
  const ZERO_WIDTH = String.fromCharCode(0x200b);

  for (const hostile of [
    "../../etc/passwd",
    "..\\..\\windows\\system32",
    `a";${CR}${LF}X-Injected: 1`,
    `x"y`, "x'y", `a${CR}${LF}b`, `a${TAB}b`, `a${NUL}b`, `a${BEL}b`,
    "a/b", "a\\b", "a;b", "a=b", "a|b", "a$(b)", "a b",
    `${RTL_OVERRIDE}fdp.exe`,
    `evidence${ZERO_WIDTH}.pdf`,
    "évidence.pdf",
    "ａｂ.pdf",
  ]) {
    const safe = safeEvidenceFilename(hostile);
    assert.match(safe, /^[A-Za-z0-9._ -]+$/, `non-allowlisted byte survived: ${JSON.stringify(safe)}`);
    assert.doesNotMatch(safe, /["'\\/;=]/, `unsafe character survived: ${JSON.stringify(safe)}`);
    assert.doesNotMatch(safe, /\.\./, `traversal survived: ${JSON.stringify(safe)}`);
    assert.equal([...safe].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126), false,
      `control or non-ASCII byte survived: ${JSON.stringify(safe)}`);
  }

  const disposition = evidenceContentDisposition(`..\\evil";${CR}${LF}drop.pdf`);
  assert.match(disposition, /^attachment; filename="[A-Za-z0-9._ -]+"$/);
  assert.equal([...disposition].some(ch => ch.charCodeAt(0) < 32), false);
});

test("only an already-accepted MIME type is echoed back", () => {
  assert.equal(safeEvidenceContentType("application/pdf", null), "application/pdf");
  assert.equal(safeEvidenceContentType(null, "image/png"), "image/png");
  assert.equal(safeEvidenceContentType("text/html", "text/html"), "application/octet-stream");
  assert.equal(safeEvidenceContentType(null, null), "application/octet-stream");
  assert.equal(safeEvidenceContentType("application/x-msdownload", "application/pdf"), "application/pdf");
});

/* -------------------------------------------------------------------- audit */

test("the audit row is written only on success and carries no content", () => {
  // Scoped to the function body: the import at the top of the file naturally
  // precedes everything and would make this vacuous.
  const body = service.slice(service.indexOf("export async function authorizeSellEvidenceDownload"));
  assert.ok(
    body.indexOf("recordSellEvidenceViewAuthorized") > body.indexOf("deps.signDownload"),
    "the audit row must follow a successful signing, not precede it",
  );
  // …and after the live scan gate, so a refused request records nothing.
  assert.ok(body.indexOf("recordSellEvidenceViewAuthorized") > body.indexOf("marketplaceScanDecision(liveTag)"));
  assert.ok(body.indexOf("recordSellEvidenceViewAuthorized") > body.indexOf('return { outcome: "not_clean" };'));
  assert.match(service, /await recordSellEvidenceViewAuthorized\(db, \{\s*sellSubmissionId: input\.sellSubmissionId,\s*attachmentId: input\.attachmentId,\s*actorId: input\.actorId,\s*\}\);/);
  assert.match(evidenceRepo, /sanitizedMetadata: \{ attachmentId: input\.attachmentId \},/);
  for (const token of ["displayFilename", "objectKey", "bucket", "signedUrl", "businessEmail", "byteSize"]) {
    const start = evidenceRepo.indexOf("export async function recordSellEvidenceViewAuthorized");
    assert.doesNotMatch(evidenceRepo.slice(start), new RegExp(token, "i"), `audit metadata must not carry ${token}`);
  }
});

/* ----------------------------------------------------------------- the view */

test("only stored-clean, undeleted evidence is linkable", () => {
  assert.match(sellDetail, /const storedClean = attachment\.scanState === "CLEAN" && !attachment\.deletedAt;/);
  // The link is gated on the scan state AND the role, so an AUDITOR is never
  // offered an anchor that would answer 403.
  assert.match(sellDetail, /const usable = storedClean && canDownload;/);
  assert.match(sellDetail, /You do not have permission to open this file\./);
  assert.match(sellDetail, /\{usable\s*\?\s*<a className="admin-evidence-open" href=\{`\/api\/admin\/marketplace\/sell-submissions\/\$\{submissionId\}\/attachments\/\$\{attachment\.id\}\/download`\}/);
  assert.match(sellDetail, /: <span className="admin-evidence-unavailable">/);
  assert.match(sellDetail, /Deleted — unavailable/);
  // Exactly one anchor exists in the evidence table, and it is inside the guard.
  assert.equal((sellDetail.match(/admin-evidence-open/g) ?? []).length, 1);
  // The compliance language survives.
  assert.match(sellDetail, /does not certify, authenticate or approve any part/);
  assert.match(sellDetail, /not an airworthiness approval/);
  assert.match(sellDetail, /does not guarantee authenticity or fitness/);
  assert.match(sellDetail, /staff review is not regulatory approval/);
});
