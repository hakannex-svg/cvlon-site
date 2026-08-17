# Civilon Price Check Phase 7 — secure document uploads

Status: deploy-preview implementation. No production Price Check, production database, production bucket, OpenAI, OCR, or document extraction is enabled.

Public privacy wording remains **PENDING FINAL LEGAL REVIEW**.

## Architecture

The browser requests a short-lived, exact-object presigned S3 POST from `POST /api/price-check/uploads/authorize`. The file body goes directly from the browser to private S3; it never passes through the Price Check JSON submission and is never stored in PostgreSQL. The final submission contains only opaque attachment handles.

Uploads are optional. S3 or GuardDuty unavailability does not prevent a requester from continuing without a document.

## Preview AWS resources

- AWS environment: Civilon non-production resources; the account identifier is intentionally not stored in this repository.
- Region: `us-east-1`.
- CloudFormation stack: `price-check-phase7-preview`.
- Dedicated bucket: `pc-doc-preview-20260816-40c6398ff2e7`.
- Application IAM user: `price-check-phase7-preview-app`.
- GuardDuty service role: `price-check-phase7-preview-guardduty`.
- GuardDuty Malware Protection for S3: active for the `quarantine/` prefix with post-scan tagging enabled.

The template is [`infra/price-check-phase-7-preview.yaml`](../infra/price-check-phase-7-preview.yaml). It creates preview resources only. It does not create access keys, production resources, or public access.

## S3 security baseline

- All four S3 Block Public Access settings are enabled.
- Bucket-owner-enforced object ownership disables ACL use.
- Server-side encryption uses S3-managed AES-256 encryption.
- The bucket policy denies non-HTTPS transport.
- No public bucket policy or public ACL exists.
- Application credentials have no `s3:ListBucket` permission.
- Object keys use random server-generated values under `quarantine/` and `bound/`; customer, company, email, part number, aircraft, Price Check reference, and filenames never appear in keys.
- A bucket-policy deny blocks reads unless `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`.
- Only GuardDuty can write its scan status on quarantined objects. The application may copy a clean tag to `bound/` only as part of an S3 server-side copy whose source is a readable quarantine object.

## IAM summary

The application identity may:

- create presigned POSTs for exact random `quarantine/` objects;
- inspect metadata and GuardDuty tags for exact known keys;
- read only objects tagged `NO_THREATS_FOUND`;
- copy a clean quarantine object into an opaque `bound/` key;
- delete exact owned quarantine/bound objects.

It cannot list the bucket, change bucket configuration, access other buckets, administer GuardDuty, or use broad `s3:*` permissions. GuardDuty uses a separate AWS service role based on the AWS-documented malware-protection permissions.

## Upload authorization and abuse controls

The authorization route requires the Price Check feature flag, an approved same-origin HTTPS host, JSON input, and an independent ten-minute attempt limiter. It validates filename, extension, declared MIME, expected size, maximum file count, and expected session bytes before issuing a five-minute presigned POST.

The S3 POST policy binds the exact bucket, random key, declared content type, upload handle metadata, expiration, and `1..10 MB` content-length range. Application credentials and secret keys never reach the browser.

Limits:

- PDF, JPEG, PNG, or WebP only;
- 10 MB per file;
- 3 files and 30 MB expected bytes per upload session;
- 12 authorization attempts per network key per 10 minutes in the current preview runtime.

## Pre-submission ownership

The server creates a high-entropy upload token in a `Secure`, `HttpOnly`, host-only, `SameSite=Lax` cookie. PostgreSQL stores only its SHA-256 hash. Purpose-built `price_check_upload_sessions` and `price_check_pending_uploads` rows associate opaque handles with exact random object keys.

At final submission the server:

1. verifies the handle count and syntax;
2. resolves every handle through the same unexpired upload-session hash;
3. rejects duplicate, forged, cross-session, expired, or previously claimed handles;
4. performs an exact-key `GetObjectTagging` existence check that cannot return object bytes before a clean tag; the presigned POST policy has already bound the exact key, declared content type, upload-handle metadata, and 10 MB ceiling;
5. atomically creates the Price Check, claims all handles, and inserts attachment metadata.

The existing non-null attachment-to-Price-Check foreign key is preserved. A failed transaction rolls back requester, Price Check, claim, attachment, revision, and audit writes together. Because S3 authorizes both `HEAD` and `GetObjectAttributes` through object-read permissions, neither is granted before the clean tag. After GuardDuty reports clean, reconciliation reads the object once and verifies the actual byte size, signature/detected MIME, PDF/image safety limits, and digest before any staff download can be issued. A mismatch is rejected and never becomes downloadable.

## Quarantine, scan and validation

GuardDuty scans new `quarantine/` objects asynchronously. The Price Check request is accepted while an attachment is `PENDING`; attachment scan state is independent of business workflow status.

- `NO_THREATS_FOUND`: the admin reconciliation operation reads the now-permitted object, performs server-side content validation, calculates SHA-256, and copies it to a random `bound/` key while preserving the clean scan tag.
- `THREATS_FOUND`: mark `REJECTED`, never read/download/process it, and let quarantine retention remove it.
- `UNSUPPORTED`, `ACCESS_DENIED`, `FAILED`, missing/unknown: fail closed as pending/failed; no download. An administrator may retry reconciliation.

Server validation ignores customer filename/MIME trust. It verifies PDF/JPEG/PNG/WebP magic, MIME agreement, byte size, image dimensions (maximum 12,000 per axis and 40 million pixels), PDF EOF/page structure (maximum 200 pages), and rejects encrypted/password-protected PDFs. It does not execute scripts, links, attachments, macros, QR codes, OCR, AI, or document field extraction.

## Retention and orphan cleanup

Preview lifecycle rules remove `quarantine/` objects after 1 day and `bound/` preview evidence after 30 days. These are preview safety limits, not a public production retention promise. Database rows retain the configured deletion due date and audit state; later lifecycle reconciliation/deletion work can mark deleted records.

## Admin access

Admin detail shows filename, size, declared/detected type, upload time, and scan state without exposing object keys or permanent URLs. Only `CLEAN` attachments show a download action.

`ANALYST`, `REVIEWER`, and `ADMIN` may request a 120-second signed GET after the server re-verifies Google OIDC session, active local staff record, capability, Price Check ownership, attachment ownership, clean database state, and exact object key. `AUDITOR` has metadata-only access by default. Signed URLs are returned only to the authorized browser, are not stored, and are not written to audit metadata. They can be reused only until their short expiration.

Only `ADMIN` can trigger scan reconciliation in Phase 7. Customers do not receive document access through result tokens.

## Audit events

The implementation records sanitized events including `UPLOAD_AUTHORIZED`, `UPLOAD_COMPLETED`, `ATTACHMENT_BOUND`, `ATTACHMENT_SCAN_PENDING`, `ATTACHMENT_SCAN_CLEAN`, `ATTACHMENT_SCAN_REJECTED`, `ATTACHMENT_SCAN_FAILED`, `ATTACHMENT_VIEW_AUTHORIZED`, and `ATTACHMENT_DELETION_SCHEDULED`. Audit metadata contains identifiers/status codes only—never content, object URLs, signed URLs, credentials, or requester form values.

## Server-only configuration

Preview branch values:

- `PRICE_CHECK_UPLOAD_AWS_REGION=us-east-1` (`AWS_REGION` remains a supported non-Netlify fallback)
- `PRICE_CHECK_UPLOAD_AWS_ACCESS_KEY_ID` (secret)
- `PRICE_CHECK_UPLOAD_AWS_SECRET_ACCESS_KEY` (secret)
- `PRICE_CHECK_UPLOAD_BUCKET=pc-doc-preview-20260816-40c6398ff2e7`

None use a `NEXT_PUBLIC_` prefix. Values are scoped to the Phase 7 preview branch in Netlify. Production remains unset and disabled.

## Production isolation and later setup

Production still requires separate owner approval for a dedicated production bucket, production IAM/workload-identity design, GuardDuty plan and cost acceptance, retention/legal policy, CORS origin, monitoring/alerting, credential rotation, and disaster/recovery procedures. Do not reuse this preview bucket or long-lived preview access key for production.

Before production, prefer short-lived workload credentials if Netlify/AWS support an approved federation pattern. Create a new least-privilege production stack, validate GuardDuty tagging and tag-based reads, approve final privacy/retention copy, run security tests, and only then enable the product in production.
